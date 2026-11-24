using System;

public class CPHInline
{
    public bool Execute()
    {
        try
        {
            CPH.ObsReplayBufferSave();
            CPH.SetGlobalVar("clip.last.ok", true, false);
            CPH.StreamDeckSetTitle("clip", "КЛИП\n✓");
            System.Threading.Thread.Sleep(1200);
            CPH.StreamDeckSetTitle("clip", "КЛИП");
        }
        catch (Exception ex)
        {
            CPH.SetGlobalVar("clip.last.ok", false, false);
            CPH.LogWarn("Replay Buffer save failed: " + ex.Message);
            try { CPH.StreamDeckSetTitle("clip", "КЛИП\nОШИБКА"); } catch (Exception) { }
        }
        return true;
    }
}
