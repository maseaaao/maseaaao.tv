using System;

public class CPHInline
{
    public bool Execute()
    {
        bool live = CPH.ObsIsStreaming();
        if (live)
            CPH.RunAction("STATE | STOP", true);
        else
            CPH.RunAction("STATE | START", true);

        try
        {
            CPH.StreamDeckSetTitle("stream_toggle", live ? "ЭФИР\nВЫКЛ" : "ЭФИР\nВКЛ");
            CPH.StreamDeckSetState("stream_toggle", live ? 0 : 1);
        }
        catch (Exception ex) { CPH.LogWarn("Stream Deck feedback unavailable: " + ex.Message); }
        return true;
    }
}
