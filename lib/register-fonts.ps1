# Registers the fonts in the Windows user's own font folder, so no administrator rights are needed.
# AddFontResource and the broadcast make them usable at once, without logging out of Windows.
$ErrorActionPreference = 'Stop'
Add-Type -Namespace HerdrTemplate -Name Fonts -MemberDefinition @'
[DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
public static extern int AddFontResourceW(string file);
[DllImport("user32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeoutW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
'@

$key = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
$files = @(Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Windows\Fonts\CaskaydiaMonoNerdFont-*.ttf")
if ($files.Count -eq 0) { throw 'No CaskaydiaMono font files found to register.' }

foreach ($file in $files) {
  $style = $file.BaseName -replace '^CaskaydiaMonoNerdFont-', ''
  New-ItemProperty -Path $key -Name "CaskaydiaMono Nerd Font $style (TrueType)" -Value $file.FullName -PropertyType String -Force | Out-Null
  if ([HerdrTemplate.Fonts]::AddFontResourceW($file.FullName) -eq 0) { throw "Windows refused the font $($file.Name)." }
}

# HWND_BROADCAST, WM_FONTCHANGE, SMTO_ABORTIFHUNG
$result = [IntPtr]::Zero
[void][HerdrTemplate.Fonts]::SendMessageTimeoutW([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$result)
"Registered $($files.Count) font files."
