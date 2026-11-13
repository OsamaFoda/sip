"""Draws Sip's toolbar icon (a water drop with a level line) at every size the manifest needs."""
import math
import os
import cairo

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def draw(size):
    s = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    cr = cairo.Context(s)
    cr.scale(size / 128, size / 128)
    # Drop outline: a circle at the bottom pulled up to a point at the top.
    cr.move_to(64, 8)
    cr.curve_to(64, 8, 22, 58, 22, 82)
    cr.arc_negative(64, 82, 42, math.pi, 0)
    cr.curve_to(106, 58, 64, 8, 64, 8)
    cr.close_path()
    cr.set_source_rgb(0.043, 0.478, 0.459)
    cr.fill_preserve()
    # Lower half lighter, like a glass partly drunk.
    cr.save()
    cr.clip()
    cr.rectangle(0, 78, 128, 50)
    cr.set_source_rgb(0.235, 0.773, 0.741)
    cr.fill()
    cr.restore()
    s.write_to_png(os.path.join(OUT, f"icon-{size}.png"))


for size in (16, 32, 48, 128):
    draw(size)
