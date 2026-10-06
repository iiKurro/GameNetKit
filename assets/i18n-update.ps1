# One-off: rewrites copy in ui\src\i18n.ts (stale texts, removed features, new messages). Run from the project root.
$f = (Resolve-Path "ui\src\i18n.ts").Path
$lines = [IO.File]::ReadAllLines($f, [Text.Encoding]::UTF8)

$remove = 'dataFolder','openData','importFile','importOk','importRuns','importBad','importOwn','importFail','exportAll','exportedAll','exportHistory','importedTag','insightsNoPeople','insightsGoImport','exported'

$upd = @{
  ar = [ordered]@{
    how2 = 'ما يلمس اللعبة، ولا يحظر شي إلا لما تضغط أنت، وما يغيّر إعدادات جهازك.'
    how3 = 'اللي يطلع من جهازك: عناوين السيرفرات لتحديد الدولة، ومع المشاركة التلقائية يُرفع للمجموعة اسمك ونتائج فحوصاتك فقط.'
    profileHint = 'اكتب اسمك مرة وحدة. يظهر لأخوياك في المجموعة مع فحوصاتك عشان يعرفون أنها منك وتنفصل عن سجلاتهم.'
    readOnlyNote = 'هذي فحوصات وصلت تلقائياً من المجموعة، للاطلاع فقط:'
    insightsIntro = 'نجمع فحوصاتك وفحوصات أعضاء المجموعة لكل لعبة، ونطلع النطاقات اللي تجيب لك سيرفرات سيّئة مرة بعد مرة. تطلع لكل لعبة أسوأ نطاقين مع الدليل: مين شافهم وكم مرة وكم كان البنق.'
    insightsEmpty = 'ما فيه فحوصات بعد. افحص ماتش، وفحوصات العيال تنضاف هنا لحالها.'
    insightsFew = 'البيانات قليلة (أقل من 3 ماتشات). افحص أكثر وبتزيد دقة الاقتراحات.'
    insightsMixed = 'سيّئ عند العيال لكنه ما كان سيّئ عندك، فما نقترح حظره.'
    insightsConfHigh = 'ثقة عالية: سيّئ عندك وعند غيرك'
    insightsConfLow = 'ثقة أقل: سيّئ عندك بس'
    insightsCaveat = 'ملاحظة: البنق يُقاس من مكان كل لاعب، فسيرفر ممكن يكون سيّئ لواحد وكويس لغيره. لهذا ما نقترح حظر نطاق إلا إذا انسجل سيّئ عندك أنت أيضاً، وما نقترح نطاق كويس عندك حتى لو سيّئ عند غيرك. ما ينحظر شي بدون ضغطتك، وتقدر تلغي أي حظر من تبويب المحظور.'
  }
  en = [ordered]@{
    how2 = 'Does not touch the game, blocks nothing unless you press the button, and does not change your settings.'
    how3 = 'What leaves your PC: server IPs (to look up the country) and, with automatic sharing, your name and scan results to the group.'
    profileHint = 'Type your name once. Your friends in the group see it next to your scans so they know they are yours and keep them apart from theirs.'
    readOnlyNote = 'These scans arrived automatically from the group, view only:'
    insightsIntro = 'We pool your scans and those of the group members, per game, and find the address ranges that keep giving you bad servers. Each game shows its two worst ranges with the evidence: who saw them, how often, and the ping.'
    insightsEmpty = 'No scans yet. Scan a match; your friends'' scans are added here by themselves.'
    insightsFew = 'Not much data yet (fewer than 3 matches). Scan more and the suggestions get more accurate.'
    insightsMixed = 'is bad for your friends but has not been bad for you, so it is not suggested.'
    insightsConfHigh = 'High confidence: bad for you and for others'
    insightsConfLow = 'Lower confidence: bad for you only'
    insightsCaveat = 'Note: ping is measured from each player''s own place, so a server can be bad for one person and fine for another. That is why a range is only suggested when it was also bad for you, and one that is fine for you is never suggested even if it is bad for others. Nothing is blocked without your click, and you can undo any block in the Blocked tab.'
  }
}

$add = @{
  ar = [ordered]@{
    errBlockProtected = 'ما انحظر شي: هذا النطاق يشمل عنواناً تحتاجه أنت (جهازك أو الراوتر أو خدمة DNS أو سيرفرات البرنامج) وحظره يقطع عليك النت.'
    errBlockBusy = 'ما قدرت أحفظ الحظر الحين (ملف الحظر مشغول). جرّب بعد ثواني.'
    errStart = 'ما بدأ الفحص. جرّب مرة ثانية.'
    errStartBusy = 'فيه فحص شغّال حالياً.'
    errSaveName = 'ما انحفظ الاسم. جرّب مرة ثانية.'
    errSaveCode = 'ما انحفظ الرمز. جرّب مرة ثانية.'
    closeLabel = 'إغلاق'
    sortLabel = 'الترتيب'
    doneEmptyTitle = 'انتهى الفحص بدون نتائج'
    syncChipCode = 'رمز المجموعة غلط'
    syncChipPlayer = 'الاسم محجوز'
    syncChipFull = 'المجموعة ممتلئة'
    syncChipNet = 'المشاركة متوقفة'
    syncChipServer = 'السيرفر ما يرد'
    syncErrFull = 'المجموعة ممتلئة أو وصلت الحد الأقصى من الفحوصات.'
    syncOff = 'المشاركة متوقفة. فعّلها بالمفتاح.'
    insightsLoadFail = 'ما انحمّلت بعض الفحوصات، بيعيد المحاولة تلقائياً.'
    insightsHeadsUp = 'سيّئ عند العيال وأنت ما لعبت عليه، فما نقترح حظره'
  }
  en = [ordered]@{
    errBlockProtected = 'Nothing was blocked: this range contains an address you need (your PC, router, a DNS service or the app''s own servers); blocking it would cut your internet.'
    errBlockBusy = 'Could not save the block right now (the block list is busy). Try again in a few seconds.'
    errStart = 'The check did not start. Try again.'
    errStartBusy = 'A check is already running.'
    errSaveName = 'The name was not saved. Try again.'
    errSaveCode = 'The code was not saved. Try again.'
    closeLabel = 'Close'
    sortLabel = 'Sort'
    doneEmptyTitle = 'The check finished with no results'
    syncChipCode = 'wrong group code'
    syncChipPlayer = 'name taken'
    syncChipFull = 'group is full'
    syncChipNet = 'sharing paused'
    syncChipServer = 'server not answering'
    syncErrFull = 'The group is full or reached the maximum number of scans.'
    syncOff = 'Sharing is off. Turn it on with the switch.'
    insightsLoadFail = 'Some scans could not be loaded; it will retry by itself.'
    insightsHeadsUp = 'was bad for your friends and you have not played on it, so it is not suggested'
  }
}

function Lit([string]$s) { return '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }

$out = New-Object System.Collections.Generic.List[string]
$lang = ''
foreach ($l in $lines) {
  if ($l -match '^  (ar|en): \{') { $lang = $Matches[1] }
  if ($l -match '^    ([A-Za-z0-9]+): ') {
    $k = $Matches[1]
    if ($remove -contains $k) { continue }
    if ($lang -and $upd[$lang].Contains($k)) { $out.Add('    ' + $k + ': ' + (Lit $upd[$lang][$k]) + ','); continue }
    if ($k -eq 'lang' -and $lang) { foreach ($ak in $add[$lang].Keys) { $out.Add('    ' + $ak + ': ' + (Lit $add[$lang][$ak]) + ',') } }
  }
  $out.Add($l)
}
[IO.File]::WriteAllLines($f, $out, (New-Object Text.UTF8Encoding($false)))
"keys now: " + (($out | Where-Object { $_ -match '^    [A-Za-z0-9]+: ' }).Count)
