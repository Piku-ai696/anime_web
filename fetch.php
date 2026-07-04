<?php
// Enable CORS so your frontend GitHub page can talk to this PHP script securely
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type, X-Requested-With, Accept");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Content-Type: application/json");

// Handle preflight OPTIONS request from browsers gracefully
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Check what action the frontend is trying to run
$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($action === 'catalog') {
    // Read the raw JSON payload sent from the frontend script
    $rawInput = file_get_contents('php://input');
    
    $ch = curl_init("https://graphql.animex.one/graphql");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $rawInput);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Accept: application/json',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        http_response_code($httpCode);
        echo json_encode(["error" => "GraphQL remote target returned status code " . $httpCode]);
        exit;
    }
    
    echo $response;
    exit;
} 

if ($action === 'sources') {
    $id = isset($_GET['id']) ? urlencode($_GET['id']) : '';
    $epNum = isset($_GET['epNum']) ? urlencode($_GET['epNum']) : '';
    $type = isset($_GET['type']) ? urlencode($_GET['type']) : '';
    
    if (!$id || !$epNum || !$type) {
        http_response_code(400);
        echo json_encode(["error" => "Missing required operational parameters"]);
        exit;
    }
    
    $sourceUrl = "https://pp.animex.one/rest/api/sources?id={$id}&epNum={$epNum}&type={$type}&providerId=mochi";
    
    $ch = curl_init($sourceUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Accept: application/json',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        http_response_code($httpCode);
    }
    
    echo $response;
    exit;
}

// Fallback response if no valid action matches
http_response_code(404);
echo json_encode(["error" => "Action endpoint target not found"]);
