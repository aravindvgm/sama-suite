import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';   // ⭐ ADD THIS

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { LoginComponent } from './auth/login/login.component';
import { OrgSelectorComponent } from './shared/org-selector/org-selector.component';
import { SidebarComponent } from './shared/sidebar/sidebar.component';
import { HasRoleDirective } from './core/directives/has-role.directive';
import { AuthBootstrapService } from './core/services/auth-bootstrap.service';

import { TeacherAttendanceComponent } from './features/attendance/teacher-attendance/teacher-attendance.component';
import { ParentAttendanceComponent } from './features/attendance/parent-attendance/parent-attendance.component';
import { PrincipalDashboardComponent } from './features/attendance/principal-dashboard/principal-dashboard.component';

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    OrgSelectorComponent,
    SidebarComponent,
    HasRoleDirective,
    TeacherAttendanceComponent,
    ParentAttendanceComponent,
    PrincipalDashboardComponent,
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,            // ⭐ VERY IMPORTANT
    AppRoutingModule
  ],
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: (bootstrap: AuthBootstrapService) => () => bootstrap.initialize(),
      deps: [AuthBootstrapService],
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }