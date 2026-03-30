# EduERP — College Management System

A full-stack College ERP built with **React**, **Node.js + Express**, and **MongoDB**.

---

## 🗂 Project Structure

```
college-erp/
├── index.html              ← Complete React frontend (self-contained)
├── backend/
│   ├── server.js           ← Express entry point
│   ├── package.json
│   ├── .env                ← Environment variables
│   ├── models/
│   │   └── index.js        ← All Mongoose schemas (User, Student, Teacher, Attendance, Marks)
│   ├── middleware/
│   │   └── auth.js         ← JWT protect & restrictTo middleware
│   └── routes/
│       └── index.js        ← All route handlers
```

---

## 🚀 Quick Start

### Frontend (React)
Just open `index.html` in your browser — no build step needed!

**Demo Login Credentials:**
| Role    | Email               | Password  |
|---------|---------------------|-----------|
| Student | student@edu.com     | stud123   |
| Teacher | teacher@edu.com     | teach123  |
| Admin   | admin@edu.com       | admin123  |

---

### Backend (Node.js + MongoDB)

**Prerequisites:** Node.js v18+, MongoDB (local or Atlas)

```bash
cd backend
npm install
```

**Configure environment:**
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and secrets
```

**Run development server:**
```bash
npm run dev
```

Server starts at `http://localhost:5000`

---

## 🔌 API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login (all roles) | Public |
| POST | `/api/auth/register` | Register user | Public |
| GET | `/api/auth/me` | Get current user | Any |
| GET | `/api/students` | List students (filter by branch/sem/div) | Any |
| POST | `/api/students` | Add student | Admin |
| PUT | `/api/students/:id` | Update student | Admin |
| DELETE | `/api/students/:id` | Delete student | Admin |
| GET | `/api/students/:id/dashboard` | Student dashboard data | Any |
| POST | `/api/attendance/mark` | Bulk mark attendance | Teacher/Admin |
| GET | `/api/attendance/student/:id` | Student attendance records | Any |
| GET | `/api/attendance/class` | Class attendance for a date | Teacher/Admin |
| GET | `/api/attendance/report` | Department-wise report | Admin |
| POST | `/api/marks` | Bulk enter marks | Teacher/Admin |
| GET | `/api/marks/student/:id` | Student marksheet | Any |
| GET | `/api/marks/class` | Class marks | Teacher/Admin |
| GET | `/api/admin/stats` | Dashboard statistics | Admin |
| GET | `/api/admin/teachers` | List teachers | Admin |
| POST | `/api/admin/teachers` | Add teacher | Admin |

---

## 🛡 Authentication
All protected routes require: `Authorization: Bearer <JWT_TOKEN>`

JWT tokens expire in **7 days**.

---

## 🧩 Role-Based Access

| Feature | Student | Teacher | Admin |
|---------|---------|---------|-------|
| View own attendance | ✅ | — | ✅ |
| View own marks | ✅ | — | ✅ |
| Mark attendance | — | ✅ | ✅ |
| Enter marks | — | ✅ | ✅ |
| Manage students | — | — | ✅ |
| Manage teachers | — | — | ✅ |
| View all reports | — | — | ✅ |

---

## 📦 Tech Stack

- **Frontend:** React 18 (CDN, no build tool)
- **Backend:** Node.js, Express 4
- **Database:** MongoDB + Mongoose 8
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Dev:** nodemon
