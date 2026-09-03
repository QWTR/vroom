Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$outputDirectory = Join-Path $PSScriptRoot '..\assets\map-markers'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-MarkerGlyph {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Kind,
    [System.Drawing.RectangleF]$Bounds,
    [System.Drawing.Color]$Color
  )

  $strokeWidth = [Math]::Max(3, $Bounds.Width * 0.075)
  $pen = [System.Drawing.Pen]::new($Color, $strokeWidth)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $brush = [System.Drawing.SolidBrush]::new($Color)

  try {
    if ($Kind -eq 'fuel') {
      $body = [System.Drawing.RectangleF]::new(
        $Bounds.X + $Bounds.Width * 0.18,
        $Bounds.Y + $Bounds.Height * 0.14,
        $Bounds.Width * 0.43,
        $Bounds.Height * 0.68
      )
      $Graphics.DrawRectangle($pen, $body.X, $body.Y, $body.Width, $body.Height)
      $window = [System.Drawing.RectangleF]::new(
        $body.X + $body.Width * 0.18,
        $body.Y + $body.Height * 0.15,
        $body.Width * 0.64,
        $body.Height * 0.22
      )
      $Graphics.FillRectangle($brush, $window)
      $Graphics.DrawLine($pen, $body.Right, $body.Y + $body.Height * 0.24, $Bounds.Right - $Bounds.Width * 0.12, $Bounds.Y + $Bounds.Height * 0.34)
      $Graphics.DrawLine($pen, $Bounds.Right - $Bounds.Width * 0.12, $Bounds.Y + $Bounds.Height * 0.34, $Bounds.Right - $Bounds.Width * 0.12, $Bounds.Y + $Bounds.Height * 0.72)
      $Graphics.DrawLine($pen, $Bounds.X + $Bounds.Width * 0.1, $body.Bottom, $Bounds.X + $Bounds.Width * 0.7, $body.Bottom)
    }
    elseif ($Kind -eq 'partner') {
      $font = [System.Drawing.Font]::new('Arial', $Bounds.Height * 0.62, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      $format = [System.Drawing.StringFormat]::new()
      $format.Alignment = [System.Drawing.StringAlignment]::Center
      $format.LineAlignment = [System.Drawing.StringAlignment]::Center
      try {
        $Graphics.DrawString('V', $font, $brush, $Bounds, $format)
      }
      finally {
        $format.Dispose()
        $font.Dispose()
      }
    }
    elseif ($Kind -eq 'meet') {
      $poleX = $Bounds.X + $Bounds.Width * 0.25
      $Graphics.DrawLine($pen, $poleX, $Bounds.Y + $Bounds.Height * 0.12, $poleX, $Bounds.Bottom - $Bounds.Height * 0.1)
      $flag = [System.Drawing.Drawing2D.GraphicsPath]::new()
      try {
        $flag.AddPolygon([System.Drawing.PointF[]]@(
          [System.Drawing.PointF]::new($poleX, $Bounds.Y + $Bounds.Height * 0.16),
          [System.Drawing.PointF]::new($Bounds.Right - $Bounds.Width * 0.12, $Bounds.Y + $Bounds.Height * 0.28),
          [System.Drawing.PointF]::new($poleX, $Bounds.Y + $Bounds.Height * 0.52)
        ))
        $Graphics.FillPath($brush, $flag)
      }
      finally {
        $flag.Dispose()
      }
      $Graphics.DrawLine($pen, $Bounds.X + $Bounds.Width * 0.1, $Bounds.Bottom - $Bounds.Height * 0.08, $Bounds.X + $Bounds.Width * 0.52, $Bounds.Bottom - $Bounds.Height * 0.08)
    }
    elseif ($Kind -eq 'camera') {
      $body = [System.Drawing.RectangleF]::new($Bounds.X + $Bounds.Width * 0.1, $Bounds.Y + $Bounds.Height * 0.25, $Bounds.Width * 0.66, $Bounds.Height * 0.48)
      $Graphics.DrawRectangle($pen, $body.X, $body.Y, $body.Width, $body.Height)
      $lens = [System.Drawing.RectangleF]::new($body.X + $body.Width * 0.23, $body.Y + $body.Height * 0.16, $body.Height * 0.68, $body.Height * 0.68)
      $Graphics.DrawEllipse($pen, $lens)
      $hood = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($body.Right, $body.Y + $body.Height * 0.18),
        [System.Drawing.PointF]::new($Bounds.Right - $Bounds.Width * 0.04, $Bounds.Y + $Bounds.Height * 0.14),
        [System.Drawing.PointF]::new($Bounds.Right - $Bounds.Width * 0.04, $Bounds.Bottom - $Bounds.Height * 0.14),
        [System.Drawing.PointF]::new($body.Right, $body.Bottom - $body.Height * 0.18)
      )
      $Graphics.FillPolygon($brush, $hood)
    }
    elseif ($Kind -eq 'drop') {
      $diamond = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($Bounds.X + $Bounds.Width * 0.5, $Bounds.Y + $Bounds.Height * 0.08),
        [System.Drawing.PointF]::new($Bounds.Right - $Bounds.Width * 0.08, $Bounds.Y + $Bounds.Height * 0.42),
        [System.Drawing.PointF]::new($Bounds.X + $Bounds.Width * 0.5, $Bounds.Bottom - $Bounds.Height * 0.06),
        [System.Drawing.PointF]::new($Bounds.X + $Bounds.Width * 0.08, $Bounds.Y + $Bounds.Height * 0.42)
      )
      $Graphics.DrawPolygon($pen, $diamond)
      $Graphics.DrawLine($pen, $diamond[0], $diamond[2])
      $Graphics.DrawLine($pen, $diamond[1], $diamond[3])
    }
  }
  finally {
    $brush.Dispose()
    $pen.Dispose()
  }
}

function Write-MapMarkerSprite {
  param(
    [string]$Name,
    [string]$Kind,
    [string]$AccentHex,
    [switch]$Card,
    [switch]$OfferBadge
  )

  $width = if ($Card) { 208 } else { 76 }
  $height = if ($Card) { 128 } else { 92 }
  $bodyBottom = if ($Card) { 112 } else { 76 }
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $accent = [System.Drawing.ColorTranslator]::FromHtml($AccentHex)
  $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(105, 0, 0, 0))
  $surface = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#0B1119'))
  $border = [System.Drawing.Pen]::new($accent, 4)
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F7FAFF'))

  try {
    if ($Card) {
      $shadowPath = New-RoundedRectanglePath 6 9 196 106 22
      $bodyPath = New-RoundedRectanglePath 4 3 200 110 22
      try {
        $graphics.FillPath($shadow, $shadowPath)
        $graphics.FillPath($surface, $bodyPath)
        $graphics.DrawPath($border, $bodyPath)
      }
      finally {
        $shadowPath.Dispose()
        $bodyPath.Dispose()
      }

      $tip = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(91, 111),
        [System.Drawing.PointF]::new(117, 111),
        [System.Drawing.PointF]::new(104, 126)
      )
      $graphics.FillPolygon($surface, $tip)
      $graphics.DrawLines($border, [System.Drawing.PointF[]]@($tip[0], $tip[2], $tip[1]))
      $graphics.DrawLine([System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#0B1119'), 5), 94, 111, 114, 111)

      $graphics.FillEllipse($white, 18, 28, 52, 52)
      Draw-MarkerGlyph $graphics $Kind ([System.Drawing.RectangleF]::new(28, 38, 32, 32)) $accent

      $accentRail = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(75, $accent.R, $accent.G, $accent.B))
      try { $graphics.FillRectangle($accentRail, 82, 18, 3, 78) } finally { $accentRail.Dispose() }

      if ($OfferBadge) {
        $badge = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#F04444'))
        $badgeBorder = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#0B1119'), 4)
        $badgeFont = [System.Drawing.Font]::new('Arial', 20, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $badgeFormat = [System.Drawing.StringFormat]::new()
        $badgeFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $badgeFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
        try {
          $graphics.FillEllipse($badge, 171, 0, 35, 35)
          $graphics.DrawEllipse($badgeBorder, 171, 0, 35, 35)
          $graphics.DrawString('%', $badgeFont, $white, [System.Drawing.RectangleF]::new(171, 0, 35, 35), $badgeFormat)
        }
        finally {
          $badgeFormat.Dispose()
          $badgeFont.Dispose()
          $badgeBorder.Dispose()
          $badge.Dispose()
        }
      }
    }
    else {
      $shadowPath = New-RoundedRectanglePath 4 7 68 70 23
      $bodyPath = New-RoundedRectanglePath 2 2 72 72 23
      try {
        $graphics.FillPath($shadow, $shadowPath)
        $graphics.FillPath($surface, $bodyPath)
        $graphics.DrawPath($border, $bodyPath)
      }
      finally {
        $shadowPath.Dispose()
        $bodyPath.Dispose()
      }
      $tip = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(27, 72),
        [System.Drawing.PointF]::new(49, 72),
        [System.Drawing.PointF]::new(38, 90)
      )
      $graphics.FillPolygon($surface, $tip)
      $graphics.DrawLines($border, [System.Drawing.PointF[]]@($tip[0], $tip[2], $tip[1]))
      $graphics.FillEllipse($white, 13, 13, 50, 50)
      Draw-MarkerGlyph $graphics $Kind ([System.Drawing.RectangleF]::new(23, 23, 30, 30)) $accent
    }

    $path = Join-Path $outputDirectory "$Name.png"
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $white.Dispose()
    $border.Dispose()
    $surface.Dispose()
    $shadow.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

Write-MapMarkerSprite 'poi-fuel-compact-2x' 'fuel' '#3498FF'
Write-MapMarkerSprite 'poi-fuel-card-2x' 'fuel' '#3498FF' -Card
Write-MapMarkerSprite 'poi-partner-compact-2x' 'partner' '#FF4F4B'
Write-MapMarkerSprite 'poi-partner-card-2x' 'partner' '#FF4F4B' -Card
Write-MapMarkerSprite 'poi-partner-offer-card-2x' 'partner' '#FF4F4B' -Card -OfferBadge
Write-MapMarkerSprite 'poi-meet-compact-2x' 'meet' '#F5C518'
Write-MapMarkerSprite 'poi-meet-card-2x' 'meet' '#F5C518' -Card
Write-MapMarkerSprite 'poi-camera-compact-2x' 'camera' '#F04444'
Write-MapMarkerSprite 'poi-drop-compact-2x' 'drop' '#F5C518'
