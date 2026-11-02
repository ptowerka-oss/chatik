#!/usr/bin/env python3
"""Правки сгенерированного Android-проекта: клавиатура и отступы под системные панели."""
import pathlib, re, sys

root = pathlib.Path('android/app/src/main')

# 1. Клавиатура сдвигает чат вверх, а не перекрывает поле ввода
manifest = root / 'AndroidManifest.xml'
t = manifest.read_text(encoding='utf-8') if manifest.exists() else ''
if t and 'windowSoftInputMode' not in t:
    t = re.sub(r'(<activity\b)', r'\1 android:windowSoftInputMode="adjustResize"', t, count=1)
    manifest.write_text(t, encoding='utf-8')
    print('manifest: adjustResize added')

# 2. Окно не залезает под строку состояния (Android 15+)
styles = root / 'res/values/styles.xml'
if styles.exists():
    s = styles.read_text(encoding='utf-8')
    if 'windowOptOutEdgeToEdgeEnforcement' not in s:
        s2 = re.sub(r'(<style name="AppTheme\.NoActionBar"[^>]*>)',
                    r'\1\n        <item name="android:windowOptOutEdgeToEdgeEnforcement">true</item>', s, count=1)
        if s2 != s:
            styles.write_text(s2, encoding='utf-8')
            print('styles: edge-to-edge opt-out added')
sys.exit(0)
