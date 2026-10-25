# تثبيت موارد قرارة على Android

## تشغيل HTTPS على الكمبيوتر

من مجلد المشروع شغّل:

```powershell
npm run dev:https
```

افتح `https://localhost:3000` على الكمبيوتر. شهادة Next.js مخصصة للتطوير على الكمبيوتر، وقد تحتاج إلى قبولها في المتصفح.

## التجربة على الهاتف عبر USB

إذا كان Android متصلًا بالكمبيوتر عبر USB، فعّل خيارات المطور وتصحيح USB، وثبّت Android Platform Tools على الكمبيوتر. بعد الموافقة على اتصال التصحيح نفّذ:

```powershell
adb reverse tcp:3000 tcp:3000
```

شغّل المشروع بـ `npm run dev` وافتح `http://localhost:3000` في Chrome على الهاتف. عنوان `localhost` استثناء آمن في المتصفح؛ أما عنوان الشبكة مثل `http://192.168.x.x:3000` فيبقى غير آمن ولا يفعّل Service Worker.

## HTTPS عبر شبكة Wi-Fi محلية

للوصول للهاتف عبر عنوان الشبكة، يلزم شهادة موثوقة تحتوي عنوان IP المحلي ضمن SAN. يمكن إنشاء شهادة تطوير محلية بواسطة `mkcert` ثم تشغيل Next.js بهذه الملفات:

```powershell
mkcert -install
New-Item -ItemType Directory -Force certificates
mkcert -cert-file certificates/qararah-lan.pem -key-file certificates/qararah-lan-key.pem 192.168.188.101 localhost 127.0.0.1
npx next dev --hostname 0.0.0.0 --experimental-https --experimental-https-key certificates/qararah-lan-key.pem --experimental-https-cert certificates/qararah-lan.pem
```

اعرض مجلد شهادة الجذر بالأمر `mkcert -CAROOT`، وانقل `rootCA.pem` إلى الهاتف. من إعدادات Android افتح **الأمان والخصوصية → مزيد من إعدادات الأمان → تثبيت شهادة → شهادة CA** (قد تختلف التسميات)، ثم اختر `rootCA.pem`. لا تنقل ولا تثبّت `rootCA-key.pem` أبدًا، ولا تتجاوز تحذير شهادة غير موثوقة. بعد ذلك افتح `https://192.168.188.101:3000`. عنوان IP يتغير حسب الشبكة؛ استخدم العنوان الحالي للكمبيوتر عند إنشاء الشهادة.

للاستخدام اليومي، الأفضل نشر التطبيق على نطاق HTTPS بشهادة صالحة بدل شهادة التطوير المحلية.

## التثبيت والتحقق

1. افتح الموقع في Chrome بعد ظهور قفل HTTPS، وسجّل الدخول كالمعتاد.
2. انتظر تحميل الصفحة ثم حدّثها مرة واحدة حتى يصبح Service Worker فعالًا.
3. من قائمة Chrome اختر **تثبيت التطبيق** أو **إضافة إلى الشاشة الرئيسية**.
4. افتح التطبيق من أيقونة الهاتف؛ يجب أن يعمل في نافذة مستقلة باسم **موارد قرارة**.
5. للتحقق على الكمبيوتر، افتح DevTools ثم **Application → Manifest** و **Service Workers**، وتأكد من ظهور الأيقونات وحالة العامل `activated`.

يخزّن Service Worker أيقونات التطبيق وصفحة توضيح انقطاع الاتصال فقط. لا يخزّن صفحات النظام أو بيانات الدخول أو سجلات الموظفين؛ لذلك يلزم الإنترنت لاستخدام وظائف الموارد البشرية.
