import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

import { LoginComponent } from './auth/login/login.component';
import { TeacherAttendanceComponent } from './features/attendance/teacher-attendance/teacher-attendance.component';
import { ParentAttendanceComponent } from './features/attendance/parent-attendance/parent-attendance.component';
import { PrincipalDashboardComponent } from './features/attendance/principal-dashboard/principal-dashboard.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: 'attendance/teacher',
    component: TeacherAttendanceComponent,
    canActivate: [authGuard],
  },
  {
    path: 'attendance/parent/:studentId',
    component: ParentAttendanceComponent,
    canActivate: [authGuard],
  },
  {
    path: 'attendance/dashboard',
    component: PrincipalDashboardComponent,
    canActivate: [authGuard],
  },
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: '**', redirectTo: 'login' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
