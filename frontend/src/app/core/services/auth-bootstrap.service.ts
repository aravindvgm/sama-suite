import { Injectable } from '@angular/core';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthBootstrapService {

  constructor(private authService: AuthService) {}

  initialize(): Promise<void> {
    return new Promise(resolve => {
      this.authService.refreshToken().subscribe({
        next: () => resolve(),
        error: () => resolve()
      });
    });
  }
}
