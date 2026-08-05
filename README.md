# BackOffice Support System

🚀 **BackOffice Support System — Local Setup Guide**
Follow these steps to set up and run the project from scratch.

---

## 📋 Prerequisites
Make sure you have these installed on your machine:
* **Git**
* **Python 3.10+**
* **Node.js (v18 or higher)**

---

## 🛠️ Installation & Setup

### 1. Clone the Repository
Open your terminal and run:
```bash
git clone https://github.com/kaveeshaDivyanjalee/BackOffice-Support-System.git
cd BackOffice-Support-System
```

### 2. Backend Setup (FastAPI)
Open a terminal, go to the `backend` folder, set up a virtual environment, and install dependencies:

#### On Windows (CMD/PowerShell):
```cmd
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

#### On Mac / Linux:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> 💡 **Note on Webhooks:** By default, the local backend will fetch using the Production Cloud n8n webhook URLs. If you want to customize them, set the environment variables `N8N_WEBHOOK_URL` and `USAGE_N8N_WEBHOOK_URL` on your system.

### 3. Frontend Setup (React)
Open a new terminal window, navigate to the `frontend` folder, and install the packages:
```bash
cd frontend
npm install
```

---

## 🏃‍♂️ Running the Project Locally
To run the application, you need to keep both the backend and frontend servers running in separate terminal windows:

### Step 1: Start the Backend
In your backend terminal (ensure the virtual environment `(venv)` is active):
```bash
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Step 2: Start the Frontend
In your frontend terminal:
```bash
npm start
```

The application will build and automatically open in your default browser at:
👉 **`http://localhost:3000`**
