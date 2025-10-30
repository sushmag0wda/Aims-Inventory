from django.db import migrations, models
import django.db.models.deletion


def approve_existing_users(apps, schema_editor):
    User = apps.get_model('core', 'User')
    User.objects.filter(is_superuser=True).update(approval_status='approved')
    for username in ['admin', 'user']:
        User.objects.filter(username__iexact=username).update(approval_status='approved')


def unapprove_seed_users(apps, schema_editor):
    User = apps.get_model('core', 'User')
    User.objects.filter(username__in=['admin', 'user']).update(approval_status='pending')


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_user_role'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='approval_status',
            field=models.CharField(choices=[('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected')], default='pending', max_length=20),
        ),
        migrations.CreateModel(
            name='HelpThread',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='help_thread', to='core.user')),
            ],
        ),
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message', models.CharField(max_length=255)),
                ('link', models.CharField(blank=True, max_length=255, null=True)),
                ('notification_type', models.CharField(blank=True, max_length=50, null=True)),
                ('is_read', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='core.user')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='HelpMessage',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('content', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('is_admin_read', models.BooleanField(default=False)),
                ('is_user_read', models.BooleanField(default=False)),
                ('sender', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sent_help_messages', to='core.user')),
                ('thread', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='messages', to='core.helpthread')),
            ],
            options={
                'ordering': ['created_at'],
            },
        ),
        migrations.RunPython(approve_existing_users, reverse_code=unapprove_seed_users),
    ]
