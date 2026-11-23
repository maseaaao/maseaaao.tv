using System;

public class CPHInline
{
    public bool Execute()
    {
        bool recording = CPH.ObsIsRecording();
        if (recording)
            CPH.ObsStopRecording();
        else
            CPH.ObsStartRecording();

        try
        {
            CPH.StreamDeckSetTitle("record_toggle", recording ? "ЗАПИСЬ\nВЫКЛ" : "ЗАПИСЬ\nВКЛ");
            CPH.StreamDeckSetState("record_toggle", recording ? 0 : 1);
        }
        catch (Exception ex) { CPH.LogWarn("Stream Deck feedback unavailable: " + ex.Message); }
        return true;
    }
}
