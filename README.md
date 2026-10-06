# GameNetKit

أداة لفحص سيرفرات الألعاب: تكشف السيرفر اللي تتصل فيه وتقيس البنق والتذبذب وفقدان الحزم، وتعرض دولته ومدينته.
A small tool that finds the game server you are connected to and measures ping, jitter and packet loss, with its country and city.

## الاستخدام / Usage
1. نزّل `GameNetKit.exe` من [Releases](../../releases/latest) (ملف واحد، ما يحتاج تثبيت).
2. شغّله: تفتح نافذة البرنامج. اختر اللعبة واضغط **ابدأ الفحص**، ووافق على نافذة صلاحيات المدير (مطلوبة للالتقاط عبر `pktmon`).
3. شغّل اللعبة وادخل ماتش فعلي، اضغط **بدأت الماتش**، والعب 4 دقايق.
4. تطلع النتائج: السيرفر الأكثر تراقك هو غالبًا سيرفر الماتش.
5. **حظر سيرفر:** على أي بطاقة اضغط «حظر السيرفر» (ويأكد مرة ثانية). يضيف التطبيق قاعدة في جدار حماية ويندوز تمنع اللعبة من الاتصال بهذا العنوان (UDP صادر فقط)، وتظهر نافذة صلاحيات المدير. «إلغاء الحظر» يحذف القاعدة. القواعد تُسمّى `GameNetKit block <ip>`، والتبويب «المحظور» يعرضها كلها.
6. **السجل:** كل فحص ينحفظ تلقائيًا، وتقدر تعرضه أو تحذفه أو تمسح سجل اللعبة. **لكل لعبة سجل منفصل** (أزرار اللعبة فوق)، وحتى الملفات في مجلد لكل لعبة: `%LOCALAPPDATA%\GameNetKit\History\<اللعبة>\` و`Results\<اللعبة>\`. مسح أو تصدير سجل لعبة ما يمس غيرها.
   **الحظر قابل للإزالة دائمًا:** تبويب «المحظور» يقرأ قواعد الجدار الفعلية (حتى لو ضاعت القائمة)، وفيه إلغاء حظر لكل قاعدة، و«فك حظر الكل» بنافذة صلاحيات وحدة، وإضافة حظر يدوي بعنوان أو نطاق. وتقدر تحذف يدويًا: `netsh advfirewall firewall delete rule name="GameNetKit block 34.165.0.0-16"`.
7. زر **تحقق من التحديث** يفحص آخر إصدار في GitHub ويحدّث البرنامج بنفسه (بموافقتك).

الألعاب المدعومة حاليًا: Rocket League، Overwatch 2 (جرّبت الواجهة بوضع محاكاة؛ الالتقاط الحقيقي مع اللعبة قيد الاختبار).

## الأمان / Safety
- الواجهة تشتغل بدون صلاحيات مدير. الصلاحيات تُطلب فقط وقت الفحص، لعملية منفصلة تسوي الالتقاط.
- Read-only: it captures UDP packet *headers* with Windows' built-in `pktmon`, pings the servers, nothing else. It never touches the game process or its memory/files, blocks nothing, and changes no settings.
- The only data that leaves your PC: the game servers' IP addresses, sent to [ip-api.com](https://ip-api.com) to look up country/city; and the update check, which calls the GitHub releases API.
- The app is a local web page served on `127.0.0.1` (random port, secret token per run) shown in an Edge app window. It makes no outside connections except the two above.
- No official statement from Epic/Blizzard covers tools like this. The risk is very low (network monitoring only), but it is not zero.

## إضافة لعبة / Add a game
ضع ملف `games.json` بجانب الـ exe:
```json
[
  { "name": "Rocket League", "process": "RocketLeague.exe", "enabled": true },
  { "name": "Overwatch 2", "process": "Overwatch.exe", "enabled": true }
]
```
والإعدادات (اختيارية) في `config.json`: `captureSeconds`, `topServers`, `pingCount`.

## البناء / Build
Requires Node.js and Windows (uses the C# compiler that ships with .NET Framework 4).
```powershell
.\build.ps1
```
ينتج `dist\GameNetKit.exe`.

## Credits
UI built with React + Tailwind. Components adapted from [21st.dev](https://21st.dev): Server Card by Mohammad Shehadeh / Hirael (MIT), Status by diceui, Vertical Stepper by sean0205.
