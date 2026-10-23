# Volta – Task Management System

## About the Project

Volta is a web-based Task Management System that helps managers assign work to employees and keep track of their progress.

In a team, it can sometimes be difficult to manage tasks, remember deadlines, check work status, and keep everyone updated. Volta provides one place where managers and employees can manage their tasks and stay informed about updates.

The website has two types of users: **Manager** and **Employee**. Both have different access and dashboards according to their roles.

The manager can create and assign tasks, check employee progress, manage meetings, and receive notifications. Employees can view their assigned tasks, update their work status, add comments, and check meeting details.

The main aim of this project is to make everyday task management easier and more organized.

## Main Features

### 1. Login and Authentication

Volta has a login system for managers and employees.

- Users can log in using their account credentials.
- Passwords are protected using password hashing.
- JWT authentication is used to manage user sessions.
- Different access permissions are provided for managers and employees.
- Protected pages require a valid login.
- Users can log out of their accounts.

### 2. Manager Dashboard

The manager dashboard provides an overview of the tasks and employees.

Managers can:

- View task-related statistics.
- Create new tasks.
- Assign tasks to employees.
- Edit existing tasks.
- Change task assignments when required.
- Set task priorities and deadlines.
- Add task descriptions and relevant details.
- Check task status and employee progress.
- View employee information.
- Delete tasks when they are no longer required.

This helps managers organize work and monitor assigned tasks from one place.

### 3. Employee Dashboard

Employees have a separate dashboard based on their role.

Employees can:

- View the tasks assigned to them.
- Read task descriptions and other details.
- Check task priorities and deadlines.
- Update the status of their tasks.
- Add comments to tasks.
- View relevant task history and updates.
- Check upcoming and overdue tasks.
- View meeting information and notifications.

Employees cannot access the manager's dashboard or manage other employees' tasks through the normal application permissions.

### 4. Task Management

Task management is the main feature of Volta.

Each task contains relevant information such as its title, description, assigned employee, priority, due date, and current status.

Managers can create, assign, edit, reassign, and delete tasks. When a task is assigned, the employee can see the task details on their dashboard.

The task data is stored in the database, so saved changes remain available after refreshing the page.

### 5. Task Status Tracking

Employees can update the status of their assigned tasks as work progresses.

The available statuses are:

- **Pending:** The task has not been started yet.
- **In Progress:** The employee is currently working on the task.
- **Completed:** The task has been completed.
- **On Hold:** Work on the task is temporarily paused.

Managers can check the current status of tasks and track their progress through the dashboard.

### 6. Task Comments and History

Employees can add comments to share updates or provide information about their work.

Volta also maintains task activity history for supported actions. For example, the history can show when a task was created or assigned.

This makes it easier to understand what happened to a task and check important changes without relying only on verbal updates.

### 7. Upcoming and Overdue Tasks

Volta displays task information based on deadlines.

- Upcoming tasks help users identify work that is due soon.
- Overdue tasks help users identify work that has passed its deadline.
- Task status and deadlines help managers monitor pending work.

These features make it easier to keep track of deadlines and prioritize work.

### 8. Notifications

Volta includes notifications for important task and meeting activities.

Notifications can inform users about events such as:

- A task being assigned or reassigned.
- An employee updating a task's status.
- A task comment being added.
- A task being completed.
- Meeting-related updates.

Users can open notifications to view the relevant information. The notification interface also tracks unread notifications and updates the unread count when notifications are read.

This helps managers and employees stay informed about important changes.

### 9. Meeting Management

Volta includes a meeting section that is available to managers and employees.

Users can view meeting information, including details such as the meeting title, date, time, description, and meeting link when provided.

Managers can create and update meeting details. Employees can view the updated information and use the meeting link to join when available.

Meeting-related notifications help users stay informed about meeting updates.

### 10. Responsive Design

The website is designed to work on different screen sizes, including:

- Mobile phones
- Tablets
- Laptops
- Desktop computers

The main dashboard, task views, meetings, and notifications were checked at different screen sizes to ensure that the important information remains accessible.

### 11. Theme and Navigation

Volta supports dark and light themes.

Users can switch between the available themes, and the selected theme is saved so it can remain selected after refreshing the page.

The website also supports normal browser navigation, including the Back and Forward buttons. Protected pages and login sessions are handled according to the user's authentication state.

## Technology Stack

The project uses the MERN stack.

| Technology | Purpose |
|---|---|
| MongoDB | Stores users, tasks, and related application data. |
| Express.js | Handles backend routes and API requests. |
| React.js | Builds the website interface and dashboards. |
| Node.js | Runs the backend application. |
| JWT | Handles authentication and protected access. |
| bcrypt | Hashes passwords before storing them. |
| REST APIs | Connects the frontend with the backend. |

## How the Project Works

The basic working flow of Volta is:

1. A user opens the website and logs in.
2. The system identifies the user's role.
3. The manager gets access to management features, while the employee gets access to their own task-related features.
4. The manager creates a task and assigns it to an employee.
5. The employee views the task and updates its status or adds comments.
6. The system saves the changes in the database.
7. Managers can check task progress and relevant activity history.
8. Notifications keep users informed about important updates.
9. Both roles can view relevant meeting information.

## Project Structure

The project is organized into frontend and backend parts.

### Frontend

The frontend contains the React application. It is responsible for displaying the login page, dashboards, task information, meetings, notifications, and other user interface elements.

It communicates with the backend through API requests.

### Backend

The backend is built with Node.js and Express.js. It handles authentication, user roles, task operations, meeting-related operations, notifications, and other application logic.

### Database

MongoDB stores the application data, including user and task information, along with other data required by the implemented features.

## Running the Project Locally

To run the project on your computer, you need Node.js, npm, and access to a MongoDB database.

### 1. Clone the repository

```bash
git clone https://github.com/madhaviporte/Volta.git
cd Volta
```

### 2. Set up the backend

Open a terminal in the backend folder:

```bash
cd Backend
npm install
```

Create or configure the `.env` file with the environment variables required by the backend, including the MongoDB connection string, authentication secret, and any other variables used by the application.

Start the backend using the project's development script:

```bash
npm run dev
```

### 3. Set up the frontend

Open another terminal in the frontend folder and install its dependencies:

```bash
npm install
```

Configure the frontend's API URL according to the environment variable used in the project. Then start the frontend using its available development script, commonly:

```bash
npm run dev
```

The exact frontend folder name and environment variable names should match the existing repository configuration.

## Deployment

Volta has been deployed as a live web application. The deployed frontend communicates with the backend, which connects to the configured MongoDB database.

The live deployment was manually checked for login, task management, employee access, notifications, meetings, responsive layouts, and browser navigation.

## Testing

The live website was manually tested for the following areas:

- Manager and employee login and logout.
- Dashboard access and role-based permissions.
- Task creation, assignment, editing, and deletion.
- Task status updates, comments, and activity history.
- Upcoming and overdue task information.
- Task and meeting notifications.
- Notification read status and unread count.
- Meeting creation, updates, details, and links.
- Dark and light theme persistence.
- Responsive layouts on mobile, tablet, and desktop screens.
- Browser Back and Forward navigation.
- Live deployment and saved data after refresh.

All 20 manual tests completed during the final testing process passed.

## Conclusion

Volta is a task management website built to make team work easier to organize and track. It provides separate access for managers and employees, task assignment, status tracking, comments, activity history, deadline tracking, notifications, and meeting management.

By keeping task details and updates in one place, the system helps managers monitor work and allows employees to understand their assigned responsibilities more clearly.

