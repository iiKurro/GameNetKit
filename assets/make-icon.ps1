# Draws the logo (same geometry as logo.svg, 256 units) with GDI+ and writes logo-*.png plus ..\src\app.ico
Add-Type -AssemblyName System.Drawing
$out = $PSScriptRoot

function Draw([int]$px) {
    $bmp = New-Object System.Drawing.Bitmap $px, $px, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
    $s = $px / 256.0
    $g.ScaleTransform($s, $s)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 58; $x = 4; $y = 4; $w = 248; $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90); $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $w - $d, $d, $d, 0, 90); $path.AddArc($x, $y + $w - $d, $d, $d, 90, 90); $path.CloseFigure()
    $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.PointF]::new(0, 0)), ([System.Drawing.PointF]::new(256, 256)), ([System.Drawing.ColorTranslator]::FromHtml('#18222d')), ([System.Drawing.ColorTranslator]::FromHtml('#0b0f14'))
    $g.FillPath($br, $path)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#2a3644')), 3
    $g.DrawPath($pen, $path)

    $green = [System.Drawing.ColorTranslator]::FromHtml('#35d07f')
    $ring = New-Object System.Drawing.Pen $green, 17
    $ring.StartCap = 'Round'; $ring.EndCap = 'Round'
    $g.DrawArc($ring, 56, 56, 144, 144, 24, 312)

    $white = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e8edf3')), 13
    $white.StartCap = 'Round'; $white.EndCap = 'Round'; $white.LineJoin = 'Round'
    $pts = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(82, 134), [System.Drawing.PointF]::new(104, 134), [System.Drawing.PointF]::new(120, 86), [System.Drawing.PointF]::new(142, 180), [System.Drawing.PointF]::new(158, 134), [System.Drawing.PointF]::new(214, 134))
    $g.DrawLines($white, $pts)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $green), 205, 125, 18, 18)
    $g.Dispose()
    return $bmp
}

function PngBytes($bmp) { $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); return ,$ms.ToArray() }

# BMP-style icon image (32-bit BGRA bottom-up + empty AND mask), understood by every Windows version and by csc
function DibBytes($bmp) {
    $n = $bmp.Width
    $ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([int]40); $bw.Write([int]$n); $bw.Write([int]($n * 2)); $bw.Write([int16]1); $bw.Write([int16]32); $bw.Write([int]0)
    $bw.Write([int]($n * $n * 4)); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
    for ($yy = $n - 1; $yy -ge 0; $yy--) { for ($xx = 0; $xx -lt $n; $xx++) { $bw.Write([int]($bmp.GetPixel($xx, $yy).ToArgb())) } }
    $maskRow = [int]([math]::Ceiling($n / 32.0) * 4)
    $bw.Write((New-Object byte[] ($maskRow * $n)))
    $bw.Flush(); return ,$ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = @()
foreach ($sz in $sizes) {
    $big = Draw ($sz * 4)                                   # supersample, then shrink for clean small sizes
    $small = New-Object System.Drawing.Bitmap $sz, $sz, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gg = [System.Drawing.Graphics]::FromImage($small); $gg.InterpolationMode = 'HighQualityBicubic'; $gg.PixelOffsetMode = 'HighQuality'; $gg.Clear([System.Drawing.Color]::Transparent)
    $gg.DrawImage($big, 0, 0, $sz, $sz); $gg.Dispose(); $big.Dispose()
    $bytes = if ($sz -ge 256) { PngBytes $small } else { DibBytes $small }
    if ($sz -eq 256 -or $sz -eq 64) { $small.Save((Join-Path $out ("logo-$sz.png")), [System.Drawing.Imaging.ImageFormat]::Png) }
    $images += [pscustomobject]@{ Size = $sz; Bytes = $bytes }
    $small.Dispose()
}

$ms = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($im in $images) {
    $dim = if ($im.Size -ge 256) { 0 } else { $im.Size }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([int16]1); $bw.Write([int16]32)
    $bw.Write([int]$im.Bytes.Length); $bw.Write([int]$offset); $offset += $im.Bytes.Length
}
foreach ($im in $images) { $bw.Write($im.Bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out '..\src\app.ico'), $ms.ToArray())
"icon written: " + $ms.Length + " bytes"
