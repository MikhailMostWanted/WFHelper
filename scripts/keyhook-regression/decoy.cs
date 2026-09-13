using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    private const byte VkF8 = 0x77;
    private const uint KeyUp = 0x0002;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);

    [STAThread]
    private static void Main(string[] args)
    {
        var triggerPath = args[0];
        var delivered = 0;
        var form = new Form
        {
            Text = "WFHelper Key Hook Regression",
            Width = 320,
            Height = 160,
            KeyPreview = true,
        };

        form.KeyDown += (_, eventArgs) =>
        {
            if (eventArgs.KeyCode == Keys.F8)
            {
                delivered += 1;
            }
        };

        var triggerTimer = new Timer { Interval = 25 };
        triggerTimer.Tick += (triggerSender, triggerEvent) =>
        {
            if (!File.Exists(triggerPath))
            {
                return;
            }

            triggerTimer.Stop();
            form.Activate();
            SetForegroundWindow(form.Handle);

            var sendTimer = new Timer { Interval = 250 };
            sendTimer.Tick += (sendSender, sendEvent) =>
            {
                sendTimer.Stop();
                var focused = GetForegroundWindow() == form.Handle;
                if (!focused)
                {
                    Console.WriteLine("DECOY_SUMMARY {\"focused\":false,\"delivered\":0}");
                    Console.Out.Flush();
                    form.Close();
                    return;
                }
                keybd_event(VkF8, 0, 0, UIntPtr.Zero);
                keybd_event(VkF8, 0, KeyUp, UIntPtr.Zero);

                var finishTimer = new Timer { Interval = 250 };
                finishTimer.Tick += (finishSender, finishEvent) =>
                {
                    finishTimer.Stop();
                    Console.WriteLine(
                        "DECOY_SUMMARY " +
                        "{\"focused\":" + focused.ToString().ToLowerInvariant() +
                        ",\"delivered\":" + delivered + "}"
                    );
                    Console.Out.Flush();
                    form.Close();
                };
                finishTimer.Start();
            };
            sendTimer.Start();
        };

        form.Shown += (shownSender, shownEvent) =>
        {
            Console.WriteLine("DECOY_READY");
            Console.Out.Flush();
            triggerTimer.Start();
        };

        Application.Run(form);
    }
}
