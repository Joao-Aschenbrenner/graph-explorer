Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size,$size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$cx = 128; $cy = 128

function Brush($r,$gg,$b,$a=255) { New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a,$r,$gg,$b)) }
function Pen($r,$gg,$b,$a=255,$w=2) { New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($a,$r,$gg,$b),$w) }

for ($i=0; $i -lt 7; $i++) {
  $r=72-$i*7; $a=[Math]::Max(8,38-$i*5)
  $b=Brush 88 166 255 $a
  $g.FillEllipse($b,$cx-$r,$cy-$r,$r*2,$r*2); $b.Dispose()
}

$nodes = @(
  @(70,67,168,85,247), @(186,67,88,166,255), @(211,130,63,185,80),
  @(184,196,168,85,247), @(72,195,63,185,80), @(44,128,88,166,255)
)

foreach ($n in $nodes) {
  $p=Pen $n[2] $n[3] $n[4] 95 2
  $g.DrawLine($p,$cx,$cy,$n[0],$n[1]); $p.Dispose()
}
foreach ($n in $nodes) {
  $b=Brush $n[2] $n[3] $n[4]
  $g.FillEllipse($b,$n[0]-7,$n[1]-7,14,14); $b.Dispose()
}

$p=Pen 88 166 255 255 7
$g.DrawEllipse($p,$cx-28,$cy-28,56,56); $p.Dispose()
$b=Brush 13 17 23
$g.FillEllipse($b,$cx-23,$cy-23,46,46); $b.Dispose()

$p=Pen 63 185 80 255 7
$p.StartCap='Round'; $p.EndCap='Round'
$g.DrawLines($p,[System.Drawing.Point[]]@(
  ([System.Drawing.Point]::new(111,129)),
  ([System.Drawing.Point]::new(124,141)),
  ([System.Drawing.Point]::new(149,111))
)); $p.Dispose()

$ms=New-Object System.IO.MemoryStream
$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes=$ms.ToArray()
$g.Dispose(); $bmp.Dispose()

$out=$PSScriptRoot
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.png'),$pngBytes)
[System.IO.File]::WriteAllBytes((Join-Path $out 'splash-logo.png'),$pngBytes)

$ico=New-Object System.IO.MemoryStream
$bw=New-Object System.IO.BinaryWriter($ico)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$pngBytes.Length); $bw.Write([uint32]22); $bw.Write($pngBytes)
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'),$ico.ToArray())
Write-Output "icons generated: png=$($pngBytes.Length) ico=$($ico.ToArray().Length)"
