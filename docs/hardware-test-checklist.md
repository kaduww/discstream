# Hardware Test Checklist

Use this checklist before calling a hardware build ready.

## Setup

- Host platform:
- CPU architecture:
- Optical drive model:
- Connection type:
- Browser/device used for playback:
- FFmpeg version:

## Browser Targets

- Open DiscStream on an iPad browser in portrait orientation.
- Rotate the iPad to landscape and confirm the layout reflows without horizontal scrolling.
- Play local audio or video on the iPad and confirm native media controls are usable.
- Open DiscStream on a TV browser or Android TV browser.
- Turn on TV mode.
- Navigate visible controls using a remote, arrow keys, or keyboard Tab.
- Confirm focus is always visible and does not jump behind the video/player area.
- Start, pause/resume, stop, and return to the media list from the TV browser.

## No Drive

- Start DiscStream with no optical drive connected.
- Confirm the UI shows a no-drive state.
- Confirm local media can still be browsed and played.
- Open Diagnostics and confirm the missing drive warning is readable.

## Audio CD

- Connect the optical drive.
- Insert an Audio CD.
- Confirm the disc is detected as Audio CD.
- Confirm separate tracks are listed.
- Play track 1.
- Pause and resume playback.
- Seek within the track.
- Use next track and previous track.
- Stop playback.
- Confirm Stop does not show a JSON body error.
- Try metadata lookup and confirm track names update or a readable warning appears.

## DVD-Video

- Insert a readable DVD-Video disc.
- Confirm DVD titles are listed.
- Confirm audio and subtitle tracks show language labels when available.
- Start main title playback.
- Stop playback.
- Start a selected title/chapter.
- Switch subtitle setting and confirm playback starts with the selected option.
- Confirm Diagnostics does not show stale stream cache growth after stop and restart.

## Local Media

- Add a server-side folder through the UI folder picker.
- Confirm subdirectories are grouped.
- Use folder filter, search, type filter, and sort controls.
- Play an MP3 or other supported audio file.
- Play an MP4/H.264/AAC file directly.
- Play a legacy/non-direct-play video and confirm HLS playback or a readable capability warning.
- Remove the folder and confirm media disappears from the library.

## Failure Cases

- Remove or unplug the optical drive during idle state.
- Stop playback while a stream is starting.
- Try a missing local media folder.
- Try a folder outside allowed browse roots.
- Run with FFmpeg unavailable and confirm Diagnostics shows an actionable warning.
- Restart DiscStream and confirm stale stream directories are cleaned.

## Result

- Pass/fail:
- Notes:
- Follow-up bugs:
