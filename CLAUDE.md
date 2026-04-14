# Blank Project — Claude Code Rules

## ก่อนแก้ไขทุกครั้ง
1. ตรวจด้วย shell 10-20 ข้อก่อนเสมอ เพื่อเข้าใจ state ปัจจุบัน
2. ห้าม assume ค่าใดๆ โดยไม่ verify จากข้อมูลจริง

## หลังแก้ไขทุกครั้ง
1. git push ทันที
2. รัน bash ~/workspace/poll_qa.sh รอผล GitHub Actions
3. ถ้า QA fail → วนแก้จนผ่านโดยไม่ต้องถาม
4. ถ้าครบ 2 ชม. ยังไม่เสร็จ → หยุดและแจ้งว่า "ครบ 2 ชม. ทำไม่เสร็จ"

## Permissions
- ทุกคำสั่งใน .claude/settings.local.json → allow หมด ไม่ต้องถาม
- ห้ามถาม confirmation ทุกกรณี รันเลย

## QA System
- Screenshots จาก GitHub Actions = source of truth
- E2E flow: เปิดหน้าแรก → ทดสอบ navigation → screenshot
- รองรับ 2 แบบ:
  1. **Static Screenshot** — Playwright ถ่ายภาพหน้าจอโดยตรง
  2. **VDO to Screenshot** — บันทึก VDO แล้ว extract frame เป็นภาพ
     - ใช้ Playwright `page.video().path()` บันทึก .webm
     - ใช้ ffmpeg extract frame: `ffmpeg -i video.webm -vf "select=eq(n\,0)" -vframes 1 frame.png`
     - เหมาะสำหรับ animation / transition ที่ static screenshot จับไม่ได้

## Shell Script Safety Rules
- ห้าม start Express / uvicorn / vite ใหม่ใน script ใดๆ
- ห้าม listen() / app.listen() / server.listen() ใน script
- ห้ามใช้ nohup node ... PORT=8080 — Replit workflow จัดการเอง
- ทุก script ที่ต้องการ HTTP → ใช้ fetch/curl ไปที่ localhost:80 เท่านั้น
- ก่อนรัน script ที่ใช้ browser → ตรวจว่า server alive ก่อนเสมอ

## Screenshot / Browser Automation Rules
- ห้ามรัน screenshot-all.js โดยไม่ถามผู้ใช้ก่อน
- หลายหน้ารวด + auto-refresh = requests มาก → อาจ SIGTERM server
- ถ้าจะรัน: ทีละ 5 หน้า, เพิ่ม delay 3-5 วินาทีระหว่างหน้า
- ห้ามรันขณะผู้ใช้กำลังใช้เว็บอยู่

## Pre-commit Checks (บังคับทุกครั้งก่อน git commit)

### 1. TDZ Guard — ทุกไฟล์ HTML ที่แก้ไข
ก่อน commit ไฟล์ HTML ทุกครั้ง ให้ตรวจ:
```bash
# ตรวจว่า let/const ทุกตัวใน script declare ก่อนถูกใช้
grep -n "let \|const " <file>.html | head -20

# ตรวจว่าไม่มี .catch(() => {}) กลืน error เงียบ
grep -n "catch(() => {})" <file>.html
```
- ทุก let/const ต้องอยู่ **ก่อน** function ที่ใช้มัน (ระวัง async .then() เรียก function ก่อน declare)
- ห้ามใช้ `.catch(() => {})` → ใช้ `.catch(e => console.warn('context:', e.message))` แทน

### 2. Silent Fail Guard
ห้ามใช้ try/catch แบบ empty:
```javascript
// ❌ ห้ามใช้
try { something(); } catch(e) {}

// ✅ ใช้แบบนี้
try { something(); } catch(e) { console.warn('context:', e.message); }
```

### 3. API Version Check (Generic)
ก่อนเรียก method ใหม่บน external library ให้ grep หา version ก่อน:
```bash
# ตรวจ version ของ library ที่ใช้
grep -n "cdn\|unpkg\|jsdelivr\|version" <file>.html | head -5
```
- ตรวจ docs ของ library version ที่ใช้ว่ารองรับ method นั้นหรือไม่
