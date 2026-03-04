import { inject } from '@angular/core';
import {
  CanActivateFn,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router
} from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  _state: RouterStateSnapshot
): boolean => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const token = authService.getAccessToken();

  if (!token) {
    router.navigate(['/login']);
    return false;
  }

  const requiredRoles: string[] | undefined = route.data?.['roles'];

  if (!requiredRoles || requiredRoles.length === 0) {
    return true;
  }

  const hasAccess = requiredRoles.some(role => authService.hasRole(role));

  if (!hasAccess) {
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};
