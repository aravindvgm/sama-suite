import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {

  private isRefreshing = false;
  private refreshSubject = new BehaviorSubject<string | null>(null);
  private redirecting = false;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    // Pass through auth endpoints without modification or refresh logic
    if (
      request.url.includes('/auth/login') ||
      request.url.includes('/auth/refresh') ||
      request.url.includes('/auth/logout')
    ) {
      return next.handle(request);
    }

    const token = this.authService.getAccessToken();
    if (token) {
      request = request.clone({
        setHeaders: { Authorization: `Bearer ${token}` }
      });
    }

    return next.handle(request).pipe(
      catchError(error => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 401 &&
          !request.url.includes('/auth/refresh')
        ) {
          return this.handle401(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private handle401(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {

    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap(newToken => {
          this.isRefreshing = false;
          this.refreshSubject.next(newToken);

          const cloned = request.clone({
            withCredentials: true,
            setHeaders: { Authorization: `Bearer ${newToken}` }
          });

          return next.handle(cloned);
        }),
        catchError(refreshError => {
          this.isRefreshing = false;

          if (!this.redirecting) {
            this.redirecting = true;
            this.authService.logout();
            this.router.navigate(['/login']);
          }

          return throwError(() => refreshError);
        })
      );
    }

    // Another request already triggered a refresh — wait for the new token
    return this.refreshSubject.pipe(
      filter((token): token is string => token !== null),
      take(1),
      switchMap(token => {
        const cloned = request.clone({
          withCredentials: true,
          setHeaders: { Authorization: `Bearer ${token}` }
        });
        return next.handle(cloned);
      })
    );
  }
}
