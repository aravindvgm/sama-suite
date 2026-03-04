import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';

interface MenuItem {
  label: string;
  route: string;
  roles?: string[];
}

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html'
})
export class SidebarComponent implements OnInit {

  private menuItems: MenuItem[] = [
    { label: 'Dashboard', route: '/dashboard' },
    { label: 'Admin Panel', route: '/admin', roles: ['ORG_ADMIN'] }
  ];

  visibleMenuItems: MenuItem[] = [];

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    this.computeMenu();
  }

  computeMenu(): void {
    this.visibleMenuItems = this.menuItems.filter(item =>
      !item.roles ||
      item.roles.some(role => this.authService.hasRole(role))
    );
  }
}
