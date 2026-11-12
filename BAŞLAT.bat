@echo off
chcp 65001 >nul
title Coin Analiz Terminali
echo ============================================
echo   COIN ANALİZ TERMİNALİ başlatılıyor...
echo   Tarayıcı otomatik açılacak: http://localhost:3001
echo   Kapatmak için bu pencereyi kapatın.
echo ============================================
start "" "http://localhost:3001"
node server.js
pause
