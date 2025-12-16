# Quick Test - Work Stations Page

## Test 1: Check if page loads

1. Start server: `npm run dev`
2. Open browser: `http://localhost:3000`
3. Login with your admin account
4. Go to: `http://localhost:3000/admin/manage`

**Expected**: You should see a page with "System Management" heading

## Test 2: Check for tabs

On the manage page, you should see:
```
[Employees] [Work Stations]
```

**Action**: Click "Work Stations" tab

**Expected**: Tab becomes highlighted/active

## Test 3: Add a test station

1. Click **"+ Add Station"** button
2. Fill in:
   - Line: `Test Line`
   - Station Name: `Test Station`
   - Department: `Production`
   - ✅ Critical for production
3. Click **"Add Station"**

**Expected**: Page reloads and shows your station

## Test 4: Look for Edit button

After creating a station, you should see:

```
Test Line
┌─────────────────────────────┐
│ Test Line - Test Station    │
│ [Critical]                  │
│                             │
│ Primary: Unassigned         │
│ Backups: None               │
│                             │
│ [Edit] [Delete]             │ ← These buttons!
└─────────────────────────────┘
```

**Action**: Click the **[Edit]** button

**Expected**: Modal opens with:
- Title: "Edit Work Station"
- Station name shown
- Department dropdown
- Critical checkbox
- Primary Worker dropdown
- Backup Workers checkboxes
- Update Station button

## If Edit Button is Missing

### Check Browser Console
1. Press **F12** (or right-click → Inspect)
2. Go to **Console** tab
3. Look for errors (red text)
4. **Copy any errors and let me know**

### Check Network Tab
1. In Developer Tools (F12)
2. Go to **Network** tab
3. Reload page
4. Check if `/admin/manage` loads successfully
5. Status should be **200** (green)

### Check HTML Source
1. Right-click on the page
2. Select **"View Page Source"**
3. Search for: `editStation`
4. You should find: `onclick="editStation('`
5. **If you don't find it**: The page template isn't loading correctly

## Common Issues

### Issue 1: "I see the tab but it's empty"
**Cause**: No stations created yet
**Fix**: Click "+ Add Station" and create one first

### Issue 2: "Tabs don't switch"
**Cause**: JavaScript not loading
**Fix**:
- Check console for errors
- Verify server is running
- Clear browser cache (Ctrl+Shift+R)

### Issue 3: "I see stations but no Edit button"
**Cause**: CSS might be hiding it or template issue
**Fix**:
- Try zooming out (Ctrl + Mouse wheel)
- Check if buttons are below the fold (scroll down in card)
- Inspect element (right-click on station card → Inspect)

## Screenshot Request

If still having issues, can you:
1. Take a screenshot of the **Work Stations tab**
2. Take a screenshot of the **browser console** (F12 → Console)
3. Share what you see

This will help me identify the exact issue!

## Emergency Workaround

If Edit button truly isn't showing, you can:

### Option A: Edit via Database
1. Go to MongoDB Atlas
2. Find your station
3. Manually update `primary_worker` and `backup_workers` fields

### Option B: Delete and Recreate
1. Click "Delete" button (this one should show)
2. Click "+ Add Station"
3. Recreate with correct settings

### Option C: Use Employee Edit Instead
1. Go to Employees tab
2. Edit each employee
3. Assign them to the station
4. This sets them as workers (though not as explicit backup)

---

**Please try the tests above and let me know what you see at each step!**

I'll wait for your response to help debug further. The Edit button IS in the code, so we just need to figure out why you're not seeing it.
