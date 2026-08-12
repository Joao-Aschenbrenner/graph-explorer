Add-Type -AssemblyName System.Drawing

function ToColor($hex) {
  $hex = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($hex.Substring(0,2),16)
  $g = [Convert]::ToInt32($hex.Substring(2,2),16)
  $b = [Convert]::ToInt32($hex.Substring(4,2),16)
  [System.Drawing.Color]::FromArgb(255,$r,$g,$b)
}

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size,$size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$cx = 128; $cy = 128

# glow
for ($i = 0; $i -lt 6; $i++) {
  $r = 62 - $i * 8
  $a = [int](44 - $i * 5)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a,88,166,255))
  $g.FillEllipse($brush, $cx-$r, $cy-$r, $r*2, $r*2)
}

$nodes = @(
  @(128, 56, '#58a6ff'),
  @(186, 76, '#a855f7'),
  @(176, 152, '#58a6ff'),
  @(80, 152, '#a855f7'),
  @(70, 76, '#58a6ff')
)

foreach ($n in $nodes) {
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70,(ToColor $n[2])), 1.2)
  $g.DrawLine($pen, $cx, $cy, $n[0], $n[1])
}

foreach ($n in $nodes) {
  $b = New-Object System.Drawing.SolidBrush(ToColor $n[2])
  $g.FillEllipse($b, $n[0]-7, $n[1]-7, 14, 14)
}

# center node
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,31,111,235))
$g.FillEllipse($b, $cx-22, $cy-22, 44, 44)
$b2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,88,166,255))
$g.FillEllipse($b2, $cx-12, $cy-12, 24, 24)

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$bmp.Dispose()

$out = "C:\Users\USUARIO\Desktop\PROJETOS\graph-explorer\assets"
[System.IO.File]::WriteAllBytes("$out\icon.png", $pngBytes)
[System.IO.File]::WriteAllBytes("$out\splash-logo.png", $pngBytes)

# ICO wrapping the PNG (PNG-in-ICO, supported on Windows)
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ico)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$pngBytes.Length)
$bw.Write([uint32]22)
$bw.Write($pngBytes)
[System.IO.File]::WriteAllBytes("$out\icon.ico", $ico.ToArray())

Write-Output "ico bytes: $($ico.ToArray().Length), png bytes: $($pngBytes.Length)"
