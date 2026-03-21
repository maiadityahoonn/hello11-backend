$path = "d:\Hello-11-App\backend\src\controllers\driverController.js"
$content = [System.IO.File]::ReadAllText($path)

$funcs = @(
    "updateDriverProfile",
    "toggleAvailability",
    "toggleOnlineStatus",
    "acceptBooking",
    "completeRide"
)

foreach ($func in $funcs) {
    if ($content.Contains("export const $func")) {
        # Find the function start
        $funcIndex = $content.IndexOf("export const $func")
        # Find the first 'try {' after the function start
        $tryIndex = $content.IndexOf("try {", $funcIndex)
        
        if ($tryIndex -gt -1) {
            # Check if already added
            $afterTry = $content.Substring($tryIndex, 100)
            if (-not $afterTry.Contains("await clearUserCache")) {
                # Insert after 'try {'
                $insertionPoint = $tryIndex + 5
                $content = $content.Insert($insertionPoint, "`n    await clearUserCache(req.driverId);")
                Write-Host "Updated $func"
            } else {
                Write-Host "$func already updated"
            }
        } else {
            Write-Host "Could not find 'try {' for $func"
        }
    } else {
        Write-Host "Could not find $func"
    }
}

[System.IO.File]::WriteAllText($path, $content)
