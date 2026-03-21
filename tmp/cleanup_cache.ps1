$path = "d:\Hello-11-App\backend\src\controllers\driverController.js"
$content = [System.IO.File]::ReadAllText($path)

# Remove the ones OUTSIDE the try block (they were added before it)
$content = $content -replace "await clearUserCache\(req.driverId\);\s+try \{", "try {"

# Ensure only one remains INSIDE the try block
# If we have try { \n await... \n await...
$content = $content -replace "(?s)try \{\s+await clearUserCache\(req.driverId\);\s+await clearUserCache\(req.driverId\);", "try {`n    await clearUserCache(req.driverId);"

[System.IO.File]::WriteAllText($path, $content)
