// core/static/js/register.js

// Local helper: Read CSRF token from cookies (same as in auth.js)
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.startsWith(name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

document.addEventListener('DOMContentLoaded', () => {
    // Attach to the form in register.html (id='registrationForm')
    const registrationForm = document.getElementById('registrationForm'); 

    if (registrationForm) {
        registrationForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const formData = new FormData(registrationForm);
            const password = formData.get('password');
            const confirmPassword = formData.get('confirm-password');

            if (password !== confirmPassword) {
                alert("Error: Passwords do not match.");
                return; 
            }
            
            // Only send the fields the API expects 
            const userData = {
                username: formData.get('username'),
                email: formData.get('email'),
                password: password
            };
            
            // Use the correct dedicated registration endpoint (no undefined API_BASE_URL)
            const apiUrl = '/api/register/'; 

            try {
                // Check the network tab if the button still does nothing
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken') 
                    },
                    body: JSON.stringify(userData),
                });
                
                const responseData = await response.json(); 

                if (response.ok) {
                    alert(responseData.message || "Registration successful!");
                    window.location.href = '/login/'; 
                } else {
                    console.error('Registration failed:', responseData);
                    let errorMessage = responseData.message || "Registration failed. Please check your inputs.";

                    if (response.status === 403) {
                        alert(errorMessage);
                        return;
                    }

                    if (responseData.username) {
                        errorMessage = `Username error: ${responseData.username.join(' ')}`;
                    } else if (responseData.password) {
                        errorMessage = `Password error: ${responseData.password.join(' ')}`;
                    }

                    alert(`Error: ${errorMessage}`);
                }

            } catch (error) {
                console.error('Network or parsing error:', error);
                alert('A network error occurred. Could not connect to the server.');
            }
        });
    } else {
        // This alert helps debug if the HTML ID is wrong
        console.error("Error: Registration form element not found. Check the ID is 'registrationForm'.");
    }
});