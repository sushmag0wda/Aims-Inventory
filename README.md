# 📚 AIMS Inventory Management System

A streamlined Django-based inventory and library management platform crafted for academic institutions. It keeps administrators and stationery maintainers in sync with real-time circulation data, approval workflows, and actionable alerts.

---

## ✨ Key Features

- **Centralised Dashboard:** Monitor departments, enrollments, issued books, and low-stock alerts at a glance. 📊
- **Role-Based Workflows:** Admins approve registrations, manage inventory, and reply to help-centre queries; maintainers track stock changes and conversations. 👥
- **Inventory & Circulation Tracking:** Log stock adjustments, book issues/returns, and maintain accurate item counts. 📦
- **Help Centre Messaging:** Built-in messaging keeps admin and maintainer teams aligned. 💬

---

## ⚙️ Setup Guide (Windows)

### Before You Start
- **Install Python** version 3.12 or newer from [python.org](https://www.python.org/downloads/). During install, tick **“Add python.exe to PATH.”**
- **Download the project ZIP** and unzip it somewhere easy, for example `C:\Users\YourName\book-management-system`.

### Step 1. Open PowerShell in the Project Folder
- Press **Start**, type **PowerShell**, and open it.
- Copy the full folder path (for example `C:\Users\YourName\book-management-system`).
- In PowerShell run:
  ```powershell
  Set-Location "C:\Users\YourName\book-management-system"
  ```

### Step 2. Make a Python Virtual Environment
- This keeps project packages separate from the rest of your computer.
- Run:
  ```powershell
  python -m venv .venv
  ```
- Turn it on (you will see `(.venv)` at the start of the line afterwards):
  ```powershell
  .\.venv\Scripts\Activate
  ```

### Step 3. Install the Needed Packages
- Run the command below. It reads the `requirements.txt` file and installs everything automatically.
  ```powershell
  pip install -r requirements.txt
  ```

### Step 4. Create the Database
- Run the migrations so the database tables are created. This will also seed ready-to-use demo logins:
  ```powershell
  python manage.py migrate
  ```
- Demo credentials (appear on the login page too):
  - **Admin portal:** `admin` / `Admin@123`
  - **Stationery portal:** `user` / `User@123`
- (Optional) create an additional admin account for yourself:
  ```powershell
  python manage.py createsuperuser
  ```

### Step 5. Start the Website
- Run the server:
  ```powershell
  python manage.py runserver
  ```
- Leave PowerShell open. In your web browser visit `http://127.0.0.1:8000/`.
- Log in with the seeded demo accounts or the superuser you created.
- To stop the server, go back to PowerShell and press **Ctrl + C**.

### Step 6. When You Finish
- Turn off the virtual environment with:
  ```powershell
  deactivate
  ```
- Close PowerShell.

You now have the Book Management System running on your computer.

---

## 📸 Screenshots

### **Dashboard & Inventory**

**Admin Dashboard**  
![Admin module]
(screenshots/landing.png)
(screenshots/landing2.png)
(screenshots/dashboard.png)
(screenshots/dashboard2.png)
(screenshots/in1.png)
(screenshots/in2.png)
(screenshots/in3.png)
(screenshots/in4.png)
(screenshots/d1.png)
(screenshots/bulk.png)
(screenshots/import_guide.png)
(screenshots/d2.png)
(screenshots/s1.png)
(screenshots/s2.png)
(screenshots/i1.png)
(screenshots/report.png)
(screenshots/pending.png)
(screenshots/musers.png)
(screenshots/notification.png)
(screenshots/ahelp.png)
(screenshots/in4.png)

**User Dashboard**  
![User module]
(screenshots/userissue.png)
(screenshots/uhelp.png)

