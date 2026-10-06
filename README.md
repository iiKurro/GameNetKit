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
   **إحصائيات السجل:** لكل لعبة نسبة ماتشاتك لكل نطاق سيرفرات ومتوسط البنق، ورسم للبنق عبر الفحوصات، وفلترة بالدولة وفرز. وإذا نطاق طلع سيّئ مرتين أو أكثر يقترح عليك حظره (ما ينحظر شي بدون ضغطك).
   **بدء الالتقاط تلقائيًا:** يكتشف بداية الماتش من حركة UDP، وزر «ابدأ الآن يدويًا» يبقى متاح. **IPv6:** يُحلَّل ويُقاس، لكن الحظر لعناوين IPv4 فقط.
   **الإعدادات (زر «الإعدادات» أعلى الصفحة):** ثلاثة خيارات تنحفظ: (1) **تشغيل الحارس تلقائياً**: يتذكر آخر اختيار لك (شغّلته = يشتغل كل مرة تفتح البرنامج، أوقفته = ما يرجع). (2) **إكمال العمل بالخلفية**: بعد قفل النافذة يبقى الحارس شغّال بدون نافذة (خفيف)، وإذا طفيته قفل النافذة يوقف الحارس. (3) **تشغيل مع ويندوز**: مهمة مجدولة بأعلى صلاحية تشغّل الحارس عند دخولك لويندوز بدون نافذة وبدون نافذة صلاحيات. تحتاج موافقة وحدة وقت التفعيل، وهي تنسخ البرنامج إلى `C:\Program Files\GameNetKit` (مجلد ما يكتب فيه إلا المدير، عشان ما أحد يقدر يبدّل الملف اللي يشتغل بصلاحيات عالية) وتسجّل المهمة `GameNetKit Guard`. تلغيها من نفس المفتاح فتنحذف المهمة والنسخة. بعد تحديث البرنامج يظهر زر «تحديث الحارس» لتحديث النسخة المثبّتة.
   **وين تنحفظ الملفات:** في `%LOCALAPPDATA%\GameNetKit` (يعني `C:\Users\<اسمك>\AppData\Local\GameNetKit`، مجلد مخفي)، وتفتحه من زر «فتح المجلد» أسفل البرنامج. فيه `History\<اللعبة>` و`Results\<اللعبة>` و`People\<الشخص>` و`Exports` و`blocks.json` و`profile.json`.
   **الأسماء والأشخاص:** أول تشغيل يسألك عن اسمك (محلي فقط، بدون حساب أو سيرفر). «تصدير كل سجلاتي» يطلع ملف واحد مقسّم باللعبة وفيه اسمك، وتستورد ملفات أخوياك بـ «استيراد سجلات صديق» فيظهر كل واحد منفصل في السجل (مجلد خاص له) وتقارن بينكم.
   **الحظر مع اللعبة (الحارس):** عند الحظر من بطاقة سيرفر اللعبة يكون الخيار الافتراضي «فقط أثناء تشغيل اللعبة». عملية «الحارس» (تُشغَّل مرة وحدة بنافذة صلاحيات وحدة، وتستمر لو قفلت النافذة) تراقب ألعابك كل ثانيتين: تفعّل حظر اللعبة لما تشتغل وتشيله لما تنقفل، بدون نافذة صلاحيات كل مرة. تتحكم فيه من تبويب «المحظور». الألعاب اللي تشترك في نفس الملف (MW3 وMW4 = `cod.exe`) تفعّل حظر الاثنين.
   **تنبيه:** إذا جدار الحماية رفض القواعد على جهازك، الحظر يتم بمسار شبكة يمس كل البرامج لهذا النطاق (مو اللعبة فقط).
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
