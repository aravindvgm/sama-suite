import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
selector:'app-login',
templateUrl:'./login.component.html'
})
export class LoginComponent{

email='';
password='';
organizationId='';
error:string|null=null;
loading=false;

constructor(private auth:AuthService,private router:Router){}

submit(){

this.error=null;

if(!this.email || !this.password || !this.organizationId){
this.error='All fields required';
return;
}

this.loading=true;

this.auth.login({
email:this.email,
password:this.password,
organizationId:this.organizationId
}).subscribe({

next:()=>{
this.loading=false;
this.router.navigate(['/dashboard']);
},

error:(err)=>{
this.loading=false;
this.error=err?.error?.message || 'Login failed';
}

});

}

}