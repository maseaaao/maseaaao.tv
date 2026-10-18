using System;

public class CPHInline
{
    public bool Execute()
    {
        // CPH.SetGlobalVar("stream_info.template.twitch", "🔴 %subtitle% | !tg !yt", true);
        // CPH.SetGlobalVar("stream_info.template.youtube", "🔴 [Battle Engine Aquila] %subtitle% | !tg !tw", true);
        CPH.SetGlobalVar("stream_info.preset.twitchCategoryId", "6930", true);
        // CPH.UnsetGlobalVar("stream_info.preset.youtubeCategoryName", true);
        CPH.UnsetGlobalVar("stream_info.preset.twitchTagsJson", true);
        // CPH.UnsetGlobalVar("stream_info.preset.youtubeTagsJson", true);
        CPH.SetArgument("command", "applyPreset");
        CPH.RunAction("STREAM INFO | API", true);
        CPH.ObsSetScene("⬅️C:L");
        return true;
    }
}