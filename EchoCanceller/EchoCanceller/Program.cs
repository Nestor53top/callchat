using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using NAudio.Wave;

namespace EchoCanceller
{
    class Program
    {
        static WaveInEvent? micCapture;
        static WasapiLoopbackCapture? loopbackCapture;
        static ConcurrentBag<WebSocket> clients = new();
        static NLMS? filter;
        static float micGain = 1.0f;

        static async Task Main(string[] args)
        {
            Console.WriteLine("=== Echo Canceller ===");
            Console.WriteLine("Подавление эха из наушников в реальном времени");
            Console.WriteLine();

            filter = new NLMS(filterLength: 2048, stepSize: 0.5f, sampleRate: 48000);

            Console.WriteLine("Микрофоны:");
            for (int i = 0; i < WaveInEvent.DeviceCount; i++)
                Console.WriteLine($"  [{i}] {WaveInEvent.GetCapabilities(i).ProductName}");

            Console.WriteLine("\nНажмите Enter для запуска (микрофон 0, loopback 0)");
            Console.Write("> ");
            Console.ReadLine();

            Console.WriteLine("WebSocket: ws://localhost:8765");
            Console.WriteLine("Нажмите Enter для остановки.\n");

            var cts = new CancellationTokenSource();
            _ = Task.Run(() => StartWebSocketServer(cts.Token));

            micCapture = new WaveInEvent
            {
                DeviceNumber = 0,
                WaveFormat = new WaveFormat(48000, 16, 1),
                BufferMilliseconds = 20
            };
            micCapture.DataAvailable += OnMicData;

            loopbackCapture = new WasapiLoopbackCapture();
            loopbackCapture.DataAvailable += OnLoopbackData;

            micCapture.StartRecording();
            loopbackCapture.StartRecording();

            Console.WriteLine("Активно. Эхо подавляется.");

            Console.ReadLine();

            cts.Cancel();
            micCapture.StopRecording();
            loopbackCapture.StopRecording();
            micCapture.Dispose();
            loopbackCapture.Dispose();
        }

        static void OnMicData(object? sender, WaveInEventArgs e)
        {
            if (filter == null) return;
            float[] mic = ToFloat(e.BytesRecorded, e.Buffer);
            float[] cleaned = filter.ProcessMic(mic);
            Broadcast(ToBytes(cleaned));
        }

        static void OnLoopbackData(object? sender, WaveInEventArgs e)
        {
            if (filter == null) return;
            filter.FeedLoopback(ToFloat(e.BytesRecorded, e.Buffer));
        }

        static void Broadcast(byte[] data)
        {
            var dead = new List<WebSocket>();
            foreach (var ws in clients)
            {
                try
                {
                    if (ws.State == WebSocketState.Open)
                        ws.SendAsync(new ArraySegment<byte>(data), WebSocketMessageType.Binary, true, CancellationToken.None).Wait(10);
                    else dead.Add(ws);
                }
                catch { dead.Add(ws); }
            }
            foreach (var d in dead) clients.TryTake(out _);
        }

        static async Task StartWebSocketServer(CancellationToken ct)
        {
            var listener = new HttpListener();
            listener.Prefixes.Add("http://localhost:8765/");
            listener.Start();
            Console.WriteLine("[WS] Запущен");

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var ctx = await listener.GetContextAsync();
                    if (ctx.Request.IsWebSocketRequest)
                    {
                        var wsCtx = await ctx.AcceptWebSocketAsync(null);
                        var ws = wsCtx.WebSocket;
                        clients.Add(ws);
                        Console.WriteLine($"[WS] Клиент (+{clients.Count})");

                        _ = Task.Run(async () =>
                        {
                            var buf = new byte[1024];
                            while (ws.State == WebSocketState.Open)
                            {
                                try
                                {
                                    var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                                    if (r.MessageType == WebSocketMessageType.Close)
                                    {
                                        ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait();
                                        clients.TryTake(out _);
                                    }
                                    else if (r.MessageType == WebSocketMessageType.Text)
                                    {
                                        string msg = Encoding.UTF8.GetString(buf, 0, r.Count);
                                        if (msg.StartsWith("gain:"))
                                        {
                                            if (float.TryParse(msg.AsSpan(5), System.Globalization.NumberStyles.Float,
                                                System.Globalization.CultureInfo.InvariantCulture, out float g))
                                                micGain = Math.Clamp(g, 0.1f, 3.0f);
                                        }
                                        else if (msg.StartsWith("gate:") && filter != null)
                                        {
                                            if (float.TryParse(msg.AsSpan(5), System.Globalization.NumberStyles.Float,
                                                System.Globalization.CultureInfo.InvariantCulture, out float t))
                                                filter.GateThreshold = Math.Clamp(t, 0.01f, 0.5f);
                                        }
                                    }
                                }
                                catch { clients.TryTake(out _); break; }
                            }
                        });
                    }
                }
                catch { if (ct.IsCancellationRequested) break; }
            }
            listener.Stop();
        }

        static float[] ToFloat(int bytes, byte[] buf)
        {
            int n = bytes / 2;
            float[] s = new float[n];
            for (int i = 0; i < n; i++) s[i] = BitConverter.ToInt16(buf, i * 2) / 32768f;
            return s;
        }

        static byte[] ToBytes(float[] samples)
        {
            byte[] buf = new byte[samples.Length * 2];
            for (int i = 0; i < samples.Length; i++)
                BitConverter.GetBytes((short)(Math.Clamp(samples[i] * micGain, -1f, 1f) * 32767)).CopyTo(buf, i * 2);
            return buf;
        }
    }
}
