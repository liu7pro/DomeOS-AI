// DomeOS AI voice service.
//
// A tiny console host for the Windows (Microsoft) speech recogniser. It listens
// continuously on the default microphone and prints exactly one line per event:
//
//   READY            the audio device is open and listening has started
//   WAKE  <text>     the built-in wake phrase was heard
//   TEXT  <text>     a finished utterance
//   HYP   <text>     a provisional (not yet final) utterance
//   ERR   <text>     the engine could not start
//
// The assembly title is what Task Manager shows, so the process reads "DomeOS AI"
// instead of the file name.
using System;
using System.Reflection;
using System.Speech.Recognition;
using System.Threading;

[assembly: AssemblyTitle("DomeOS AI")]
[assembly: AssemblyProduct("DomeOS AI")]
[assembly: AssemblyDescription("DomeOS AI voice service")]
[assembly: AssemblyCompany("DomeOS Team")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class DomeVoiceProgram
{
    private static void Emit(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    [STAThread]
    private static void Main()
    {
        // the host reads these lines as UTF-8; without this the Chinese text arrives as mojibake
        try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
        catch { }

        SpeechRecognitionEngine engine;
        Grammar wake;
        try
        {
            engine = new SpeechRecognitionEngine();

            // The installed recogniser here is Chinese, so the wake phrase is spelled the
            // way that engine transcribes it rather than in English letters.
            var choices = new Choices();
            string[] wakeWords = { "嘿豆", "嗨豆", "嘿，豆", "嗨，豆", "嘿豆姆", "嗨豆姆", "嘿 DOM", "嗨 DOM", "黑豆", "嘿多姆", "嗨多姆" };
            foreach (string word in wakeWords)
                choices.Add(word);

            var builder = new GrammarBuilder();
            builder.Culture = engine.RecognizerInfo.Culture;
            builder.Append(choices);
            wake = new Grammar(builder);
            engine.LoadGrammar(wake);

            // Dictation runs alongside the wake grammar so the sentence that follows the
            // wake phrase is captured in full.
            engine.LoadGrammar(new DictationGrammar());
        }
        catch (Exception ex)
        {
            Emit("ERR grammar " + ex.Message.Replace('\n', ' ').Replace('\r', ' '));
            Environment.Exit(1);
            return;
        }

        engine.SpeechRecognized += delegate(object sender, SpeechRecognizedEventArgs e)
        {
            try { Emit((e.Result.Grammar == wake ? "WAKE " : "TEXT ") + e.Result.Text); }
            catch { }
        };
        engine.SpeechHypothesized += delegate(object sender, SpeechHypothesizedEventArgs e)
        {
            try { if (e.Result.Grammar != wake) Emit("HYP " + e.Result.Text); }
            catch { }
        };

        try
        {
            engine.SetInputToDefaultAudioDevice();
            engine.RecognizeAsync(RecognizeMode.Multiple);
            Emit("READY");
        }
        catch (Exception ex)
        {
            Emit("ERR audio " + ex.Message.Replace('\n', ' ').Replace('\r', ' '));
            Environment.Exit(1);
            return;
        }

        Thread.Sleep(Timeout.Infinite);
    }
}
