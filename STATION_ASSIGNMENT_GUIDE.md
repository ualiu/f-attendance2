# Work Station Assignment Guide

## Overview
You can now fully manage work station assignments including primary workers and backup workers through the web interface.

## How to Assign Workers to Stations

### Method 1: Edit Station (Recommended)

1. **Go to Admin → Manage**
2. **Click "Work Stations" tab**
3. **Click "Edit" on any station**

The Edit Station modal will open with:

#### **Station Information**
- Station Name (read-only - shows the full name)
- Department (can change)
- Critical for Production checkbox

#### **Worker Assignment**
- **Primary Worker**: Select ONE employee from dropdown
  - This is the main person assigned to this station
  - Their employee profile will automatically update to show this station
  - Only one primary worker per station

- **Backup Workers**: Check multiple employees
  - These are people who can cover this station
  - Can select multiple backups
  - Scroll through the list and check all applicable employees
  - Good practice: Have 2-3 backups per critical station

4. **Click "Update Station"**
5. Page reloads with changes saved

### Method 2: Edit Employee

You can also assign a station to an employee directly:

1. **Go to Admin → Manage → Employees tab**
2. **Click "Edit" on any employee**
3. **Select "Work Station" from dropdown**
4. **Click "Update Employee"**

**Note**: This only sets which station the employee works at. To set them as PRIMARY or BACKUP, use Method 1 (Edit Station).

## What Each Assignment Does

### **Primary Worker Assignment**
When you assign a primary worker to a station:
- ✅ Employee's profile shows this as their work station
- ✅ Station card shows this employee as primary
- ✅ If employee is absent, station is marked as "affected"
- ✅ Dashboard shows which stations are down
- ✅ Only ONE primary worker per station

### **Backup Worker Assignment**
When you add backup workers:
- ✅ Station shows backup coverage status
- ✅ Reports show stations with/without backup
- ✅ AI reports analyze backup coverage
- ✅ Multiple backups allowed per station

## Best Practices

### ✅ **DO:**
- Assign primary worker to every station
- Add 2-3 backup workers per critical station
- Cross-train employees on multiple stations
- Mark production-critical stations as "Critical"
- Regularly review and update assignments

### ❌ **DON'T:**
- Leave critical stations without backup
- Assign same person as primary to multiple stations
- Forget to update when employees change roles

## Example Setup

### **Line 1 - Station A** (Critical)
- **Primary**: John Smith
- **Backups**:
  - ☑ Maria Garcia
  - ☑ Tom Wilson
  - ☑ Sarah Johnson

### **Line 1 - Station B** (Critical)
- **Primary**: Maria Garcia
- **Backups**:
  - ☑ John Smith
  - ☑ David Lee

### **Line 2 - Station A** (Not Critical)
- **Primary**: David Lee
- **Backups**: None needed

## Station Status in Dashboard

After assignments are made:

### **Dashboard Shows:**
- Total employees
- Present/Absent counts
- **Affected Stations**: Stations where primary worker is absent
  - 🔴 RED = Critical station down, no backup
  - 🟡 YELLOW = Station down, has backup coverage

### **Work Stations Page Shows:**
- All stations grouped by line
- Primary worker name (linked to profile)
- Number of backup workers
- Operational status

## Common Scenarios

### **Scenario 1: Employee Absent**
1. Employee calls in sick
2. AI logs the absence
3. Dashboard automatically shows:
   - Employee marked as absent
   - Their station marked as "affected"
   - Alert if no backup coverage

### **Scenario 2: Reassign Primary Worker**
1. Go to station edit
2. Change primary worker dropdown
3. Save
4. Old worker's profile: station removed
5. New worker's profile: station added

### **Scenario 3: Add Backup Coverage**
1. Edit station
2. Scroll backup workers list
3. Check additional employees
4. Save
5. Station now shows increased backup count

### **Scenario 4: Employee Leaves Company**
1. Delete employee from Employees tab
2. If they were a primary worker:
   - Station becomes "Unassigned"
   - You'll need to assign a new primary
3. If they were a backup:
   - Automatically removed from backup lists

## Reports Impact

### **AI Reports Include:**
- Stations with no backup coverage (⚠️ risk)
- Stations most affected by absences
- Recommendations for cross-training
- Primary worker absence rates

### **Example Report Output:**
```
CRITICAL GAPS:
- Line 1 - Station B: 8 days down, NO backup ⚠️ URGENT
- Line 2 - Station A: 3 days down, has 2 backups

RECOMMENDATIONS:
- Assign backup workers to Line 1 - Station B
- Consider reassigning primary worker with high absence rate
- Cross-train Maria Garcia on Line 2 stations
```

## Troubleshooting

### **Problem**: Can't see employees in dropdown
**Solution**: Make sure you've added employees first in the Employees tab

### **Problem**: Station shows "Unassigned"
**Solution**: Edit the station and select a primary worker

### **Problem**: Changes don't save
**Solution**:
- Check browser console (F12) for errors
- Verify server is running
- Check MongoDB connection

### **Problem**: Employee shows wrong station
**Solution**:
- Go to station edit
- Verify they're set as primary
- Or edit employee directly and change station

## Quick Reference

| Action | Location | Steps |
|--------|----------|-------|
| Assign Primary Worker | Admin → Manage → Stations | Edit station → Select primary dropdown |
| Add Backup Workers | Admin → Manage → Stations | Edit station → Check backup checkboxes |
| Change Employee's Station | Admin → Manage → Employees | Edit employee → Select station dropdown |
| View Station Status | Dashboard → Work Stations | Click "Work Stations" in sidebar |
| See Affected Stations | Dashboard | View "Affected Stations Today" section |

## Video Walkthrough (If Available)
1. Adding a station with assignments
2. Editing station assignments
3. Viewing impact on dashboard
4. Generating station coverage report

---

**Need Help?** See README.md for full documentation or QUICKSTART.md for setup guide.
