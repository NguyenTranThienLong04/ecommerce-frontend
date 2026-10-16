document.addEventListener("DOMContentLoaded", () => {

const BASE = window.AppConfig.apiBase;
const API_URL = BASE;

// ===============================
// VALIDATE
// ===============================

function validateRegister(data) {
  const errors = {};

  // trim
  for (let key in data) {
    if (typeof data[key] === "string") {
      data[key] = data[key].trim();
    }
  }

  if (!data.name) {
    errors.name = "Tên không được để trống";
  }

  if (!data.email) {
    errors.email = "Email không được để trống";
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      errors.email = "Email không hợp lệ";
    }
  }

  if (!data.phone) {
    errors.phone = "SĐT không được để trống";
  } else {
    const phoneRegex = /^(0|\+84)[3-9][0-9]{8}$/;
    if (!phoneRegex.test(data.phone)) {
      errors.phone = "SĐT không hợp lệ";
    }
  }

  if (!data.password) {
    errors.password = "Mật khẩu không được để trống";
  } else if (data.password.length < 6) {
    errors.password = "Mật khẩu tối thiểu 6 ký tự";
  }

  return errors;
}

function validateLogin(data) {
  const errors = {};

  if (!data.email) {
    errors.email = "Email không được để trống";
  }

  if (!data.password) {
    errors.password = "Mật khẩu không được để trống";
  }

  return errors;
}


// ===============================
// SHOW ERROR
// ===============================

function showErrors(errors, formClass) {
  document.querySelectorAll(`.${formClass} .error-text`).forEach(e => e.remove());

  for (let key in errors) {
    const input = document.getElementById(`${formClass}-${key}`);
    if (!input) continue;

    const error = document.createElement("p");
    error.className = "error-text";
    error.style.color = "red";
    error.style.fontSize = "12px";
    error.innerText = errors[key];

    input.parentNode.appendChild(error);
  }
}

// clear lỗi realtime
document.querySelectorAll("input").forEach(input => {
  input.addEventListener("input", () => {
    const err = input.parentNode.querySelector(".error-text");
    if (err) err.remove();
  });
});


// ===============================
// REGISTER
// ===============================

const registerForm = document.querySelector('.register__form');

if (registerForm) {
  registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (registerForm.dataset.busy) return;

    const data = {
      name: document.getElementById('register-name').value,
      email: document.getElementById('register-email').value,
      phone: document.getElementById('register-phone').value,
      password: document.getElementById('register-password').value
    };

    const errors = validateRegister(data);

    if (Object.keys(errors).length > 0) {
      showErrors(errors, "register");
      return;
    }

    const button = registerForm.querySelector('button[type="submit"]');
    registerForm.dataset.busy = "true";
    button.disabled = true;
    try {
      const res = await Api.fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Đăng ký thất bại');
        return;
      }

      alert('Đăng ký thành công 🎉');

      // reset form
      registerForm.reset();

    } catch (err) {
      alert(err.message);
    } finally {
      delete registerForm.dataset.busy;
      button.disabled = false;
    }
  });
}


// ===============================
// LOGIN
// ===============================

const loginForm = document.querySelector('.login__form');

if (loginForm) {
  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (loginForm.dataset.busy) return;

    const data = {
      email: document.getElementById('login-email').value,
      password: document.getElementById('login-password').value
    };

    const errors = validateLogin(data);

    if (Object.keys(errors).length > 0) {
      showErrors(errors, "login");
      return;
    }

    const button = loginForm.querySelector('button[type="submit"]');
    loginForm.dataset.busy = "true";
    button.disabled = true;
    try {
      const res = await Api.fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.message || 'Sai email hoặc mật khẩu');
        return;
      }

      if (typeof result.token !== "string" || !result.user) throw Api.error(502);
      alert('Đăng nhập thành công ✅');

      if (result.token) {
        localStorage.setItem('token', result.token);
        localStorage.setItem("user", JSON.stringify(result.user));
        window.location.href = "/account";
      }

    } catch (err) {
      alert(err.message);
    } finally {
      delete loginForm.dataset.busy;
      button.disabled = false;
    }
  });
}

});
