using System.Windows;
using Messenger.Services;

namespace Messenger.Windows;

public partial class LoginWindow : Window
{
    private bool _isRegister;

    public LoginWindow()
    {
        InitializeComponent();
    }

    private void Reg_Click(object sender, RoutedEventArgs e)
    {
        _isRegister = !_isRegister;
        NickBox.Visibility = _isRegister ? Visibility.Visible : Visibility.Collapsed;
        RegBtn.Content = _isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Регистрация";
        ErrorText.Text = "";
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        ErrorText.Text = "";
        var email = EmailBox.Text.Trim();
        var pass = PassBox.Password;

        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(pass))
        {
            ErrorText.Text = "Заполните все поля";
            return;
        }

        try
        {
            if (_isRegister)
            {
                var nick = NickBox.Text.Trim();
                if (string.IsNullOrEmpty(nick)) { ErrorText.Text = "Введите никнейм"; return; }
                var reg = await Api.SignUp(email, pass);
                if (reg == null) { ErrorText.Text = "Ошибка регистрации"; return; }
                Api.SetToken(reg.Value.token);
                await Api.Post("profiles", $"{{\"id\":\"{reg.Value.userId}\",\"nickname\":\"{nick}\",\"color\":\"#7c3aed\"}}");
                var chat = new ChatWindow(reg.Value.userId, nick);
                chat.Show(); Close();
            }
            else
            {
                var login = await Api.SignIn(email, pass);
                if (login == null) { ErrorText.Text = "Неверный логин или пароль"; return; }
                Api.SetToken(login.Value.token);
                var profiles = await Api.Get($"profiles?id=eq.{login.Value.userId}&select=nickname");
                var nick = profiles[0].GetProperty("nickname").GetString() ?? "User";
                var chat = new ChatWindow(login.Value.userId, nick);
                chat.Show(); Close();
            }
        }
        catch (Exception ex)
        {
            ErrorText.Text = "Ошибка: " + ex.Message;
        }
    }
}
