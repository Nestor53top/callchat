using System;

namespace EchoCanceller
{
    class NLMS
    {
        float[] weights;
        float[] xBuffer;
        int filterLen;
        float stepSize;
        float regularization = 1e-6f;
        float[] loopbackHistory;
        int loopbackPos;
        int sampleRate;
        int delaySamples;

        public float GateThreshold = 0.05f;
        bool gateOpen = false;
        int silentFrames = 0;

        public NLMS(int filterLength, float stepSize, int sampleRate)
        {
            this.filterLen = filterLength;
            this.stepSize = stepSize;
            this.sampleRate = sampleRate;
            weights = new float[filterLength];
            xBuffer = new float[filterLength];
            loopbackHistory = new float[filterLength + 4800];
            loopbackPos = 0;
            delaySamples = (int)(sampleRate * 0.03);
        }

        public void FeedLoopback(float[] samples)
        {
            for (int i = 0; i < samples.Length; i++)
            {
                loopbackHistory[loopbackPos % loopbackHistory.Length] = samples[i];
                loopbackPos++;
            }
        }

        float[] delayBuffer = new float[4800];
        int delayPos = 0;

        public float[] ProcessMic(float[] micSamples)
        {
            float[] output = new float[micSamples.Length];

            for (int i = 0; i < micSamples.Length; i++)
            {
                float mic = micSamples[i];

                delayBuffer[delayPos % delayBuffer.Length] = mic;
                int readPos = (delayPos - delaySamples + delayBuffer.Length) % delayBuffer.Length;
                float micDelayed = delayBuffer[readPos];
                delayPos++;

                int lpIdx = (loopbackPos - micSamples.Length + i + loopbackHistory.Length * 2) % loopbackHistory.Length;
                float echo = 0;
                float power = 0;

                for (int j = 0; j < filterLen; j++)
                {
                    int idx = (lpIdx - j + loopbackHistory.Length) % loopbackHistory.Length;
                    float x = loopbackHistory[idx];
                    echo += weights[j] * x;
                    power += x * x;
                }

                float error = micDelayed - echo;
                float norm = power + regularization;

                for (int j = 0; j < filterLen; j++)
                {
                    int idx = (lpIdx - j + loopbackHistory.Length) % loopbackHistory.Length;
                    weights[j] += stepSize * error * loopbackHistory[idx] / norm;
                }

                float absSignal = Math.Abs(mic);
                if (absSignal > GateThreshold)
                {
                    silentFrames = 0;
                    gateOpen = true;
                }
                else
                {
                    silentFrames++;
                    if (silentFrames > 5) gateOpen = false;
                }

                if (!gateOpen)
                    error = 0;

                output[i] = Math.Clamp(error, -1f, 1f);
            }

            return output;
        }
    }
}
