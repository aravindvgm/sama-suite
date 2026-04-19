import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthBootstrapService {

  constructor(private authService: AuthService) {}

  initialize(): Promise<void> {
    // No /auth/refresh during APP_INITIALIZER — avoids any HTTP during bootstrap so
    // the login UI renders immediately. Previous fire-and-forget refresh:
    // this.authService.refreshToken().subscribe({
    //   next: () => {},
    //   error: () => {}
    // });
    return Promise.resolve();
  }
}
