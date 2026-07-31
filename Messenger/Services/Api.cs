using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Messenger.Services;

public static class Api
{
    private static readonly HttpClient Http = new();
    private const string Url = "https://zerqyfvvafzfnglzszlr.supabase.co";
    private const string Key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcnF5ZnZ2YWZ6Zm5nbHpzemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NTQzMTAsImV4cCI6MjEwMTAzMDMxMH0.KXNjeThlDdGSAUhxhfNwsdY0VwAUCBImMjmXRc8X0ik";

    private static string? _accessToken;

    public static void SetToken(string token) => _accessToken = token;

    private static HttpRequestMessage Req(string path, string method = "GET", string? body = null)
    {
        var req = new HttpRequestMessage(new HttpMethod(method), $"{Url}/rest/v1/{path}");
        req.Headers.Add("apikey", Key);
        if (_accessToken != null)
            req.Headers.Add("Authorization", $"Bearer {_accessToken}");
        req.Headers.Add("Prefer", method == "POST" ? "return=representation" : "");
        if (body != null)
            req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        return req;
    }

    public static async Task<JsonElement> Get(string path)
    {
        var resp = await Http.SendAsync(Req(path));
        var json = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    public static async Task<JsonElement> Post(string path, string body)
    {
        var resp = await Http.SendAsync(Req(path, "POST", body));
        var json = await resp.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    // Auth
    public static async Task<(string userId, string token)?> SignUp(string email, string password)
    {
        var body = JsonSerializer.Serialize(new { email, password });
        var req = new HttpRequestMessage(HttpMethod.Post, $"{Url}/auth/v1/signup");
        req.Headers.Add("apikey", Key);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        var resp = await Http.SendAsync(req);
        var json = await resp.Content.ReadAsStringAsync();
        var el = JsonSerializer.Deserialize<JsonElement>(json);
        if (el.TryGetProperty("access_token", out var tok))
            return (el.GetProperty("user").GetProperty("id").GetString()!, tok.GetString()!);
        return null;
    }

    public static async Task<(string userId, string token)?> SignIn(string email, string password)
    {
        var body = JsonSerializer.Serialize(new { email, password });
        var req = new HttpRequestMessage(HttpMethod.Post, $"{Url}/auth/v1/token?grant_type=password");
        req.Headers.Add("apikey", Key);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        var resp = await Http.SendAsync(req);
        var json = await resp.Content.ReadAsStringAsync();
        var el = JsonSerializer.Deserialize<JsonElement>(json);
        if (el.TryGetProperty("access_token", out var tok))
            return (el.GetProperty("user").GetProperty("id").GetString()!, tok.GetString()!);
        return null;
    }
}
