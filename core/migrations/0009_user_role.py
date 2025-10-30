from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_departmentitemrequirement'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='role',
            field=models.CharField(choices=[('admin', 'Admin'), ('stationery', 'Stationery Maintainer')], default='stationery', max_length=32),
        ),
    ]
