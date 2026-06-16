<?php
// Deliberately vulnerable sample (PHP) -- AUTHORIZED security-education lab.
// Each numbered comment marks a PLANTED weakness for the SAST module to detect.
// Do NOT deploy this; it is a static-analysis scan target only.

$mysqli = new mysqli("localhost", "root", "", "app");

// [VULN] $_GET concatenated into a query -> SQL injection
$id = $_GET['id'];
$res = $mysqli->query("SELECT * FROM users WHERE id = " . $id);

// [VULN] $_POST concatenated into mysqli_query -> SQL injection
mysqli_query($mysqli, "INSERT INTO log(msg) VALUES('" . $_POST['msg'] . "')");

// [VULN] echo of $_GET without escaping -> reflected XSS
echo "Hello " . $_GET['name'];

// [VULN] system / exec / shell_exec / passthru on $_GET -> command injection
system("ping -c 1 " . $_GET['host']);
$out = shell_exec("whois " . $_REQUEST['domain']);
passthru("cat " . $_GET['file']);

// [VULN] include / require with user input -> LFI / RFI
include($_GET['page'] . ".php");
require_once($_REQUEST['module']);

// [VULN] unserialize on user input -> PHP object injection
$obj = unserialize($_COOKIE['session']);

// [VULN] loose == comparison on a hash/token -> type juggling auth bypass
$stored = "0e462097431906509019562988736854";
if (md5($_POST['password']) == $stored) {
    echo "authenticated";
}

// [VULN] extract() on request data -> variable overwrite
extract($_REQUEST);
?>
