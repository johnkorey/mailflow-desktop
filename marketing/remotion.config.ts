import {Config} from '@remotion/cli/config';

// 1920x1080 @ 30fps. H.264 with reasonable quality ceiling.
// The full video is 210 seconds (6,300 frames).
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // auto-detect CPU cores
