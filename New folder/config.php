<?php
// Configuration file for live server
define('SITE_ROOT', dirname(__FILE__));
define('SITE_URL', 'http' . (isset($_SERVER['HTTPS']) ? 's' : '') . '://' . $_SERVER['HTTP_HOST']);

// Set proper headers
header('Content-Type: text/html; charset=utf-8');
header('X-UA-Compatible: IE=edge');

// Error reporting (turn off in production)
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', SITE_ROOT . '/error_log.txt');
?>
