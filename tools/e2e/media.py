"""Small real media files for the cases, made once with ffmpeg and kept in ~/.cache."""
import os
import subprocess

CACHE = os.path.expanduser("~/.cache/sip-e2e-media")


def _make(name, args):
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args, path + ".tmp.webm"], check=True)
        os.replace(path + ".tmp.webm", path)
    with open(path, "rb") as f:
        return f.read()


def video():
    """Six seconds of 640x360 VP8 with sound, about 0.5 MB."""
    return _make("clip.webm", ["-f", "lavfi", "-i", "testsrc=duration=6:size=640x360:rate=24",
                               "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
                               "-c:v", "libvpx", "-b:v", "700k", "-c:a", "libvorbis", "-shortest"])


def audio():
    """Six seconds of Vorbis sound in WebM."""
    return _make("sound.webm", ["-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-c:a", "libvorbis"])


def slow(data, chunk=32_768):
    """A body sent in pieces with pauses, so a transfer the browser stops really stops."""
    for i in range(0, len(data), chunk):
        yield data[i:i + chunk]
        yield None
