using System;

public class CPHInline
{
    public bool Execute()
    {
        CPH.SetGlobalVar("stream_info.template.twitch", "🔴 %subtitle% | !tg !yt", true);
        CPH.SetGlobalVar("stream_info.template.youtube", "🔴 [BloodRayne: Terminal Cut] %subtitle% | !tg !tw", true);
        CPH.SetGlobalVar("stream_info.preset.twitchCategoryId", "1049959238", true);
        CPH.UnsetGlobalVar("stream_info.preset.youtubeCategoryName", true);
        CPH.UnsetGlobalVar("stream_info.preset.twitchTagsJson", true);
        CPH.UnsetGlobalVar("stream_info.preset.youtubeTagsJson", true);
        CPH.SetArgument("command", "applyPreset");
        CPH.RunAction("STREAM INFO | API", true);
        CPH.ObsSetScene("↙️B:L");
        return true;
    }
}