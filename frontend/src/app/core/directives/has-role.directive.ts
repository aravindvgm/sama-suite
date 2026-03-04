import { Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Directive({ selector: '[hasRole]' })
export class HasRoleDirective {

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private authService: AuthService
  ) {}

  @Input('hasRole')
  set hasRoleInput(value: string | string[] | null | undefined) {
    this.updateView(value);
  }

  private updateView(value: string | string[] | null | undefined): void {
    this.viewContainer.clear();

    let roles: string[];

    if (!value || (Array.isArray(value) && value.length === 0)) {
      return;
    } else if (Array.isArray(value)) {
      roles = value;
    } else {
      roles = [value];
    }

    const hasAccess = roles.some(role => this.authService.hasRole(role));

    if (hasAccess) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
