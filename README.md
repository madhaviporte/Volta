# Volta – Task Management System

## About the Project

Volta is a web-based task management system built to make it easier for managers and employees to manage daily work.

In a team, keeping track of assigned tasks, deadlines, work progress, and meeting updates can become difficult when everything is handled separately. Volta brings these activities together in one place.

The application has two types of users: **Manager** and **Employee**. Each user has a separate dashboard with access based on their role.

Managers can manage employee accounts, create and assign tasks, track progress, manage meetings, and receive updates. Employees can view their assigned tasks, update their work status, add comments, and check meeting information.

The main goal of Volta is to make task management simple and keep managers and employees updated about their work.

## Live Project

- **Frontend:** https://volta-indol.vercel.app
- **Backend:** https://volta-vh57.onrender.com

## Main Features

### 1. Login and Authentication

- Separate login access for managers and employees.
- Passwords are hashed before being stored.
- JWT authentication is used to manage user sessions.
- Protected routes prevent unauthorized access.
- Role-based permissions control which features users can access.
- Users can log out securely.

### 2. Manager Dashboard

The manager dashboard provides an overview of employees and their assigned tasks.

Managers can:

- View task statistics and employee progress.
- Create, edit, assign, reassign, and delete tasks.
- Set task priorities and deadlines.
- Add task descriptions and instructions.
- View employee information.
- Track task status and completion.
- Manage employee accounts.
- View task history and notifications.

### 3. Employee Dashboard

Employees have a separate dashboard where they can manage their assigned work.

Employees can:

- View their assigned tasks.
- Check task descriptions, priorities, and deadlines.
- Update task status.
- Add comments to tasks.
- View task history and updates.
- Check upcoming and overdue tasks.
- View meeting details and notifications.

Employees can access only their own task-related information through the application's role-based permissions.

### 4. Employee Management

Managers can manage employee accounts from the Employee Management section.

- Create employee accounts.
- Edit employee details.
- Update an employee's password.
- Reset passwords when required.
- Delete employee accounts.

Employees cannot change their own passwords through the employee dashboard.

### 5. Task Management

Task management is the main part of Volta.

Each task contains information such as its title, description, assigned employee, priority, due date, and current status.

Managers can create and assign tasks, make changes when required, and track their progress. Employees can view their tasks and update their status.

Task information is stored in MongoDB, so saved changes remain available after refreshing the application.

### 6. Task Status Tracking

Employees can update the status of their tasks as work progresses.

The available statuses are:

- **Pending:** Work has not started yet.
- **In Progress:** The employee is working on the task.
- **Completed:** The task has been finished.
- **On Hold:** Work is temporarily paused.

Managers can check these statuses from their dashboard.

### 7. Task Comments and History

Employees can add comments to share work updates or provide additional information.

Volta also keeps a record of supported task activities, such as task creation and assignment.

This helps managers and employees understand the changes made to a task.

### 8. Upcoming and Overdue Tasks

Volta uses task deadlines to help users keep track of their work.

- Upcoming tasks show work that is due soon.
- Overdue tasks help identify tasks that have passed their deadlines.
- Task status and due dates make it easier to monitor pending work.

### 9. Notifications and Email Updates

Volta includes an in-app notification system for important task and meeting activities.

Users can receive notifications for events such as:

- Task assignment and reassignment.
- Task status changes.
- New task comments.
- Task completion.
- Meeting updates.

The notification section keeps track of unread notifications and updates the unread count when notifications are read.

The application also supports email notifications for important updates, including task assignments and deadline reminders.

**Email integration includes:**

- Gmail API integration using OAuth 2.0.
- Automatic access token refresh.
- SMTP support as an alternative email provider.
- Email error handling so that an email failure does not stop the main task or notification operation.

### 10. Meeting Management

Volta has a meeting section that is available to both managers and employees.

Managers can create and update meeting information, including:

- Meeting title.
- Date and time.
- Agenda and details.
- Participants.
- Meeting status.
- Meeting summary and action items.

Employees can view the meeting information and stay updated when meeting details change.

### 11. Manager Profile

Managers can update their own account information and change their password from the profile settings.

### 12. Dark and Light Mode

Volta supports both dark and light themes.

Users can switch between the two themes. The selected theme is saved and remains active after refreshing the page.

### 13. Responsive Design

The application is designed to work on different screen sizes, including:

- Mobile phones.
- Tablets.
- Laptops.
- Desktop computers.

The dashboards, task sections, meetings, and notifications have been checked on different screen sizes.

## Technology Stack

| Technology | Purpose |
|---|---|
| MongoDB | Stores users, tasks, meetings, and related data. |
| Express.js | Handles backend routes and API requests. |
| React.js | Builds the frontend and dashboards. |
| Node.js | Runs the backend application. |
| JWT | Handles authentication and protected access. |
| bcrypt | Hashes user passwords. |
| REST APIs | Connects the frontend and backend. |
| Gmail API | Sends email notifications. |
| OAuth 2.0 | Handles Gmail API authorization. |
| CSS | Handles styling and responsive layouts. |

## How the Project Works

1. A user opens the website and logs in using their credentials.
2. The system checks the user's role.
3. The manager gets access to management features, while the employee gets access to their assigned tasks.
4. The manager creates a task and assigns it to an employee.
5. The employee views the task and updates its status or adds comments.
6. The application saves the changes in MongoDB.
7. The manager can track task progress and view task history.
8. Notifications and email updates keep users informed about important activities.
9. Both managers and employees can view meeting information.

## Project Structure

The project is divided into three main parts:

### Frontend

The frontend is built with React and Vite. It contains the login page, manager and employee dashboards, task sections, employee management, meetings, notifications, and theme settings.

### Backend

The backend is built with Node.js and Express.js. It handles authentication, role-based access, employee management, task operations, meetings, notifications, and email services.

### Database

MongoDB stores user accounts, tasks, meeting information, notifications, comments, and other application data.

## Running the Project Locally

To run Volta locally, you need Node.js, npm, and a MongoDB database.

### 1. Clone the Repository

```bash
git clone https://github.com/madhaviporte/Volta.git
cd Volta
```

### 2. Set Up the Backend

```bash
cd Backend
npm install
```

Create a `.env` file using the variables listed in `Backend/.env.example`. Add the required database connection string, JWT secret, and other configuration values.

Start the backend:

```bash
npm run dev
```

### 3. Set Up the Frontend

Open another terminal:

```bash
cd Frontend
npm install
```

Create a `.env` file using `Frontend/.env.example` and configure the backend API URL.

Start the frontend:

```bash
npm run dev
```

The frontend and backend should now be running locally.

## Deployment

Volta is deployed as a live web application.

- **Frontend:** Hosted on Vercel.
- **Backend:** Hosted on Render.
- **Database:** MongoDB Atlas.

The frontend communicates with the deployed backend through REST APIs. Environment variables and email credentials are configured separately in the deployment platforms.

## Testing

The project was tested before deployment.

Testing included:

- Manager and employee login.
- Role-based access and protected routes.
- Employee account creation and management.
- Task creation, assignment, editing, reassignment, and deletion.
- Task status updates and comments.
- Task history and deadline tracking.
- In-app notifications and unread notification count.
- Email notification delivery.
- Meeting creation and updates.
- Manager profile and password updates.
- Dark and light theme persistence.
- Responsive layouts.
- Browser Back and Forward navigation.
- Live frontend and backend communication.

**Backend automated tests:** 159 tests passed.

**Frontend:** Production build completed successfully.

**Code quality:** ESLint checks passed.

## Conclusion

Volta brings task management, employee management, notifications, and meeting updates together in one application.

Managers can assign work and monitor progress, while employees can manage their tasks and share updates. Features like deadline tracking, email notifications, task history, and meeting updates help keep daily work organized.

The project was built using the MERN stack and deployed as a working web application.