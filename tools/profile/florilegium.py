"""Load Florilegium's pinned SVG engine; keep upstream files in ignored tmp/."""

from io import BytesIO
from pathlib import Path
import shutil
import subprocess
from urllib.request import urlopen
from zipfile import ZipFile

from svglib.svglib import svg2rlg


THEME = Path(__file__).resolve().parent
CACHE = THEME.parents[1] / "tmp" / "pdfs" / "florilegium-v2.0.1"
RELEASE = "https://github.com/kevinraymond/florilegium/releases/download/v2.0.1/florilegium.zip"


def library():
    source = CACHE / "florilegium"
    if not (source / "florilegium-svg.lua").exists():
        source.mkdir(parents=True, exist_ok=True)
        with urlopen(RELEASE) as response, ZipFile(BytesIO(response.read())) as bundle:
            for member in bundle.infolist():
                name = Path(member.filename).name
                if name == "LICENSE" or (name.startswith("florilegium") and name.endswith(".lua")):
                    (source / name).write_bytes(bundle.read(member))
    return source / "florilegium-svg.lua"


def margin(page, left_mm):
    """Return a vector background using upstream layout, drawing and SVG export."""
    result = subprocess.run(
        [shutil.which("texlua") or "lua", str(library()),
         "--theme", "zx", "--seed", "29", "--page", str(page),
         "--left", f"{left_mm}mm", "--top", "15mm", "--bottom", "20mm",
         "--ink", "3D7D64", "--accent", "BB6652", "--density", "0.68",
         "--novisitors", "--nohead"],
        cwd=THEME, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace").strip()
                           or "Florilegium could not render the page margin")
    return svg2rlg(BytesIO(result.stdout))
