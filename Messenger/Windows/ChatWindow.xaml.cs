using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Messenger.Services;

namespace Messenger.Windows;

public partial class ChatWindow : Window
{
    private readonly string _myId;
    private readonly string _myNick;
    private readonly ObservableCollection<ContactItem> _contacts = new();
    private readonly ObservableCollection<MsgItem> _messages = new();
    private string? _currentConvId;
    private string? _currentContactId;
    private readonly Dictionary<string, string> _nickCache = new();
    private System.Threading.Timer? _pollTimer;

    public ChatWindow(string userId, string nickname)
    {
        InitializeComponent();
        _myId = userId;
        _myNick = nickname;
        MyNickText.Text = nickname;
        ContactsList.ItemsSource = _contacts;
        MsgList.ItemsSource = _messages;
        Loaded += async (_, _) => await LoadContacts();
    }

    private async Task LoadContacts()
    {
        var profiles = await Api.Get("profiles?id=neq.{_myId}&select=id,nickname,color");
        _contacts.Clear();
        foreach (var p in profiles.EnumerateArray())
        {
            var id = p.GetProperty("id").GetString()!;
            var nick = p.GetProperty("nickname").GetString() ?? "?";
            var color = p.GetProperty("color").GetString() ?? "#7c3aed";
            _nickCache[id] = nick;
            _contacts.Add(new ContactItem { Id = id, Nickname = nick, FirstChar = nick.Length > 0 ? nick[..1].ToUpper() : "?", Color = color });
        }
    }

    private async void Contact_Selected(object sender, SelectionChangedEventArgs e)
    {
        if (ContactsList.SelectedItem is not ContactItem c) return;
        _currentContactId = c.Id;

        // Get or create conversation
        var sorted = new[] { _myId, c.Id }.OrderBy(x => x).ToArray();
        var convs = await Api.Get($"conversations?user1=eq.{sorted[0]}&user2=eq.{sorted[1]}&select=id");
        if (convs.GetArrayLength() == 0)
        {
            var newConv = await Api.Post("conversations", $"{{\"user1\":\"{sorted[0]}\",\"user2\":\"{sorted[1]}\"}}");
            _currentConvId = newConv[0].GetProperty("id").GetString()!;
        }
        else
        {
            _currentConvId = convs[0].GetProperty("id").GetString()!;
        }

        ChatHeader.Text = c.Nickname;
        Placeholder.Visibility = Visibility.Collapsed;
        MsgInput.IsEnabled = true;
        SendBtn.IsEnabled = true;

        await LoadMessages();
        StartPolling();
    }

    private async Task LoadMessages()
    {
        if (_currentConvId == null) return;
        var msgs = await Api.Get($"messages?conversation_id=eq.{_currentConvId}&order=created_at.asc&limit=100&select=sender_id,content,created_at");
        _messages.Clear();
        foreach (var m in msgs.EnumerateArray())
        {
            var sender = m.GetProperty("sender_id").GetString()!;
            var content = m.GetProperty("content").GetString()!;
            var time = DateTime.Parse(m.GetProperty("created_at").GetString()!).ToLocalTime().ToString("HH:mm");
            _nickCache.TryGetValue(sender, out var name);
            _messages.Add(new MsgItem { SenderName = name ?? "User", Content = content, Time = time, IsMine = sender == _myId });
        }
        MsgScroll.ScrollToEnd();
    }

    private void StartPolling()
    {
        _pollTimer?.Dispose();
        var lastCount = _messages.Count;
        _pollTimer = new System.Threading.Timer(async _ =>
        {
            if (_currentConvId == null) return;
            try
            {
                var msgs = await Api.Get($"messages?conversation_id=eq.{_currentConvId}&order=created_at.asc&limit=100&select=sender_id,content,created_at");
                if (msgs.GetArrayLength() != lastCount)
                {
                    lastCount = msgs.GetArrayLength();
                    Dispatcher.Invoke(() => _ = LoadMessages());
                }
            }
            catch { }
        }, null, 1000, 1000);
    }

    private async void Send_Click(object sender, RoutedEventArgs e) => await SendMsg();

    private async void MsgInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { e.Handled = true; await SendMsg(); }
    }

    private async Task SendMsg()
    {
        var text = MsgInput.Text.Trim();
        if (string.IsNullOrEmpty(text) || _currentConvId == null) return;
        MsgInput.Text = "";
        await Api.Post("messages", $"{{\"conversation_id\":\"{_currentConvId}\",\"sender_id\":\"{_myId}\",\"content\":\"{text.Replace("\"", "\\\"")}\"}}");
        await LoadMessages();
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        _pollTimer?.Dispose();
        new LoginWindow().Show();
        Close();
    }
}

public class ContactItem
{
    public string Id { get; set; } = "";
    public string Nickname { get; set; } = "";
    public string FirstChar { get; set; } = "";
    public string Color { get; set; } = "#7c3aed";
}

public class MsgItem
{
    public string SenderName { get; set; } = "";
    public string Content { get; set; } = "";
    public string Time { get; set; } = "";
    public bool IsMine { get; set; }
}
